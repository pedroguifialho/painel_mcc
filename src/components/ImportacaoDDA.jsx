import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseDateString, parseCurrency } from '../lib/utils';
import { UploadCloud, CheckCircle2, AlertCircle, AlertTriangle, FilterX, Save, FileSpreadsheet, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';

const ImportacaoDDA = ({ baseData, onImportSuccess }) => {
    const [isProcessingFile, setIsProcessingFile] = useState(false);
    const [isSavingInProgress, setIsSavingInProgress] = useState(false);
    const [ddaPreview, setDdaPreview] = useState(null);
    const [pastedData, setPastedData] = useState('');

    const [ddaIgnoredSuppliers, setDdaIgnoredSuppliers] = useState(() => {
        try { return JSON.parse(localStorage.getItem('ddaIgnoredSuppliers') || '[]'); }
        catch { return []; }
    });

    const handleFileUpload = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setIsProcessingFile(true);
        let allImportedRecords = [];

        try {
            for (const file of files) {
                const records = await readFile(file);
                allImportedRecords = [...allImportedRecords, ...records];
            }

            if (allImportedRecords.length === 0) {
                setIsProcessingFile(false);
                alert('Nenhum dado válido encontrado nos arquivos.');
                return;
            }

            // Filtrar fornecedores ignorados
            const filteredRecords = allImportedRecords.filter(r => !ddaIgnoredSuppliers.includes(r.nome));
            compareDDAWithBase(filteredRecords);
        } catch (error) {
            console.error('Erro ao processar arquivos:', error);
            alert('Erro ao processar um dos arquivos: ' + error.message);
            setIsProcessingFile(false);
        }

        e.target.value = null; // Reset input
    };

    // Processa dados colados diretamente do Excel (colunas separadas por tab)
    // Formato esperado: A=Vencimento, B=Beneficiário, C=(ignorado), D=Pagador, E=(ignorado), F=Valor
    const handlePasteImport = () => {
        if (!pastedData.trim()) return alert('Cole os dados primeiro.');
        setIsProcessingFile(true);

        setTimeout(() => {
            const lines = pastedData.split('\n').filter(l => l.trim());
            const records = [];

            for (let i = 0; i < lines.length; i++) {
                const cols = lines[i].split('\t');

                const rawVenc = cols[0] ? cols[0].trim() : '';
                const nome = cols[1] ? cols[1].trim().toUpperCase() : '';
                const pagador = cols[3] ? cols[3].trim() : '';
                const rawValor = cols[5] ? cols[5].trim() : '';

                if (!rawVenc || rawVenc.toLowerCase().includes('vencimento')) continue;

                const data_iso = parseDateString(rawVenc);
                if (!data_iso) continue;

                const valor = parseCurrency(rawValor);
                if (valor <= 0) continue;

                records.push({
                    _id: 'paste_' + i + '_' + Date.now() + Math.random(),
                    vencimento: rawVenc,
                    nome: nome || 'FORNECEDOR DDA NÃO IDENTIF.',
                    descricao: 'BOLETO DDA IMPORTADO',
                    observacao: determineObservation(pagador),
                    valor,
                    data_iso,
                    action: 'pending',
                });
            }

            if (records.length === 0) {
                alert('Nenhum dado válido encontrado. Verifique se as colunas estão no formato: Vencimento | Beneficiário | - | Pagador | - | Valor');
                setIsProcessingFile(false);
                return;
            }

            setPastedData('');
            const filteredRecords = records.filter(r => !ddaIgnoredSuppliers.includes(r.nome));
            compareDDAWithBase(filteredRecords);
        }, 200);
    };

    const readFile = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            const fileName = file.name.toLowerCase();

            reader.onload = (event) => {
                try {
                    let rows = [];
                    if (fileName.endsWith('.csv')) {
                        const text = event.target.result;
                        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
                        const sep = lines[0].includes(';') ? ';' : ',';
                        rows = lines.map(line => line.split(sep));
                        resolve(processCSVRows(rows));
                    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                        const data = new Uint8Array(event.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        // header: 1 returns array of arrays
                        rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                        resolve(processExcelRows(rows));
                    } else {
                        reject(new Error('Formato não suportado'));
                    }
                } catch (e) {
                    reject(e);
                }
            };

            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));

            if (fileName.endsWith('.csv')) {
                reader.readAsText(file, 'ISO-8859-1');
            } else {
                reader.readAsArrayBuffer(file);
            }
        });
    };

    const determineObservation = (pagador) => {
        if (!pagador) return 'IMPORTADO AUTOMATICAMENTE (DDA)';
        const p = pagador.toUpperCase();
        if (p.includes('MARQUES E MARQUES')) return 'DDA MM';
        if (p.includes('FARM HOME')) return 'DDA FH';
        return 'IMPORTADO AUTOMATICAMENTE (DDA)';
    };

    const processCSVRows = (rows) => {
        // Mantendo a lógica original do CSV (dados a partir da linha 6)
        if (rows.length < 6) return [];
        
        const records = [];
        for (let i = 5; i < rows.length; i++) {
            const values = rows[i];
            let vencimento = values[0] ? values[0].trim() : '';
            let nome = values[1] ? values[1].trim().toUpperCase() : '';
            let valorStr = values[4] ? values[4].trim() : '';

            if (!vencimento || vencimento.toLowerCase().includes('total')) continue;
            const data_iso = parseDateString(vencimento);
            if (!data_iso) continue;
            const valor = parseCurrency(valorStr);
            if (valor <= 0) continue;

            records.push({
                _id: 'csv_' + i + '_' + Date.now() + Math.random(),
                vencimento,
                nome: nome || 'FORNECEDOR DDA NÃO IDENTIF.',
                descricao: 'BOLETO DDA IMPORTADO',
                observacao: 'IMPORTADO AUTOMATICAMENTE (DDA)', // CSV antigo não tinha campo pagador
                valor,
                data_iso,
                action: 'pending',
            });
        }
        return records;
    };

    const processExcelRows = (rows) => {
        // Excel conforme imagem: A(0)=Vencimento, B(1)=Beneficiário, D(3)=Pagador, F(5)=Valor
        // Assume cabeçalho na linha 1, dados na linha 2 em diante
        if (rows.length < 2) return [];

        const records = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) continue;

            const rawVenc = row[0];
            const nome = row[1] ? String(row[1]).trim().toUpperCase() : '';
            const pagador = row[3] ? String(row[3]).trim() : '';
            const rawValor = row[5]; // Conforme imagem, o valor está na coluna F

            if (!rawVenc || (typeof rawVenc === 'string' && rawVenc.toLowerCase().includes('vencimento'))) continue;
            
            const data_iso = parseDateString(rawVenc);
            if (!data_iso) continue;

            const valor = parseCurrency(rawValor);
            if (valor <= 0) continue;

            const vencFormatado = rawVenc instanceof Date || typeof rawVenc === 'number' 
                ? data_iso.split('-').reverse().join('/')
                : String(rawVenc).trim();

            records.push({
                _id: 'xls_' + i + '_' + Date.now() + Math.random(),
                vencimento: vencFormatado,
                nome: nome || 'FORNECEDOR DDA NÃO IDENTIF.',
                descricao: 'BOLETO DDA IMPORTADO',
                observacao: determineObservation(pagador),
                valor,
                data_iso,
                action: 'pending',
            });
        }
        return records;
    };

    const compareDDAWithBase = (importedRecords) => {
        let newRecords = [];
        let divergentRecords = [];
        let exactRecords = [];

        importedRecords.forEach(record => {
            let matchType = 'new';
            let bestBaseMatch = null;

            for (const baseItem of baseData) {
                const isSameName = (baseItem.nome || '').toLowerCase() === (record.nome).toLowerCase();
                const isExactDate = baseItem.data_iso === record.data_iso;
                const valueDiff = Math.abs(baseItem.valor - record.valor);
                const isExactValue = valueDiff < 0.01;

                if (isSameName && isExactDate && isExactValue) {
                    matchType = 'exact';
                    bestBaseMatch = baseItem;
                    break;
                }

                if (valueDiff <= 5) {
                    const baseDateObj = new Date(baseItem.data_iso);
                    const recDateObj = new Date(record.data_iso);
                    const diffTime = Math.abs(recDateObj - baseDateObj);
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                    if (diffDays <= 3) {
                        if (matchType !== 'exact') {
                            matchType = 'divergent';
                            bestBaseMatch = baseItem;
                        }
                    }
                }
            }

            if (matchType === 'exact') {
                record.baseMatch = bestBaseMatch;
                exactRecords.push(record);
            } else if (matchType === 'divergent') {
                record.baseMatch = bestBaseMatch;
                divergentRecords.push(record);
            } else {
                newRecords.push(record);
            }
        });

        setDdaPreview({ newRecords, divergentRecords, exactRecords });
        setIsProcessingFile(false);
    };

    const handleDDAAction = (id, actionType, sourceList) => {
        setDdaPreview(prev => {
            const newState = { ...prev };

            if (actionType === 'unlink' && sourceList === 'divergentRecords') {
                const list = [...newState.divergentRecords];
                const index = list.findIndex(r => r._id === id);
                if (index !== -1) {
                    const [item] = list.splice(index, 1);
                    item.action = 'pending';
                    item.baseMatch = null;
                    newState.divergentRecords = list;
                    newState.newRecords = [...newState.newRecords, item];
                }
                return newState;
            }

            const list = [...newState[sourceList]];
            const index = list.findIndex(r => r._id === id);
            if (index !== -1) {
                if (actionType === 'delete') {
                    list.splice(index, 1);
                } else {
                    list[index] = { ...list[index], action: actionType };
                }
                newState[sourceList] = list;
            }
            return newState;
        });
    };

    const handleIgnoreSupplier = (nome) => {
        if (!window.confirm(`Tem certeza que deseja ignorar permanentemente todos os lançamentos DDA futuros do fornecedor "${nome}"?`)) return;

        const updated = [...ddaIgnoredSuppliers, nome];
        setDdaIgnoredSuppliers(updated);
        localStorage.setItem('ddaIgnoredSuppliers', JSON.stringify(updated));

        setDdaPreview(prev => {
            return {
                newRecords: prev.newRecords.filter(r => r.nome !== nome),
                divergentRecords: prev.divergentRecords.filter(r => r.nome !== nome),
                exactRecords: prev.exactRecords.filter(r => r.nome !== nome),
            };
        });
    };

    const saveToBackend = async () => {
        if (!ddaPreview) return;

        const toInsert = [
            ...ddaPreview.newRecords.filter(r => r.action === 'insert'),
            ...ddaPreview.divergentRecords.filter(r => r.action === 'insert') 
        ];

        if (toInsert.length === 0) return alert('Nenhum lançamento foi selecionado para Inserir.');

        setIsSavingInProgress(true);

        try {
            const payload = toInsert.map(r => ({
                vencimento: r.vencimento,
                nome: r.nome,
                descricao: r.descricao,
                valor: r.valor,
                observacao: r.observacao
            }));

            const { error } = await supabase
                .from('payments')
                .insert(payload);
            if (error) throw error;

            alert(`${toInsert.length} lançamentos importados com sucesso!\n\nEles já constam no Dashboard Geral vinculados ao banco de dados.`);
            setDdaPreview(null);
            if (onImportSuccess) onImportSuccess();
        } catch (err) {
            console.error(err);
            alert('Erro ao salvar no banco de dados: ' + (err.message || 'Verifique o console.'));
        } finally {
            setIsSavingInProgress(false);
        }
    };

    return (
        <div className="card">
            <h2 style={{ marginBottom: '1rem' }}>Sincronização DDA</h2>
            <p className="text-muted" style={{ marginBottom: '2rem' }}>
                Importe os relatórios DDA das empresas Marques e Marques e Farm Home via arquivo ou colando diretamente do Excel.
            </p>

            {!ddaPreview ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '2rem', alignItems: 'stretch' }}>

                    {/* Método 1: Upload de arquivo */}
                    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Upload de Arquivo</h3>
                        <label className="dropzone" style={{ flex: 1, minHeight: '180px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', cursor: isProcessingFile ? 'not-allowed' : 'pointer' }}>
                            {isProcessingFile ? <Loader2 size={48} className="animate-spin" color="var(--color-accent)" /> : <UploadCloud size={48} />}
                            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                                <span style={{ fontWeight: 600, display: 'block', color: 'var(--color-text-base)' }}>Clique para anexar arquivo(s)</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Suporta .csv, .xlsx, .xls</span>
                            </div>
                            <input
                                type="file"
                                accept=".csv,.xlsx,.xls"
                                multiple
                                onChange={handleFileUpload}
                                style={{ display: 'none' }}
                                disabled={isProcessingFile}
                            />
                        </label>
                    </div>

                    {/* Método 2: Colar do Excel */}
                    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '0.25rem' }}>Colar do Excel</h3>
                        <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                            Selecione as células no DDA e cole aqui.<br/>
                            Colunas esperadas: <strong>Vencimento | Beneficiário | — | Pagador | — | Valor</strong>
                        </p>
                        <textarea
                            value={pastedData}
                            onChange={(e) => setPastedData(e.target.value)}
                            placeholder="Copie as células do Excel DDA e cole aqui..."
                            style={{
                                flex: 1,
                                minHeight: '180px',
                                padding: '1rem',
                                background: 'var(--color-bg-base)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                color: 'var(--color-text-base)',
                                resize: 'none',
                                fontFamily: 'monospace',
                                fontSize: '0.82rem',
                            }}
                            disabled={isProcessingFile}
                        />
                        <button
                            onClick={handlePasteImport}
                            disabled={!pastedData.trim() || isProcessingFile}
                            className="btn btn-primary"
                            style={{ marginTop: '1rem', alignSelf: 'flex-end' }}
                        >
                            {isProcessingFile ? 'Processando...' : 'Processar Dados Colados'}
                        </button>
                    </div>

                </div>
            ) : (
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <div>
                            <h3 style={{ fontSize: '1.25rem' }}>Resultado da Análise</h3>
                            <p className="text-muted">
                                Novos/Pendentes: <strong style={{ color: 'var(--color-accent)' }}>{ddaPreview.newRecords.length + ddaPreview.divergentRecords.length}</strong> |
                                Já Conciliados: <strong>{ddaPreview.exactRecords.length}</strong>
                            </p>
                        </div>
                        <button
                            className="action-btn"
                            onClick={saveToBackend}
                            disabled={isSavingInProgress}
                        >
                            {isSavingInProgress ? 'Salvando...' : (
                                <>
                                    <Save size={18} /> Salvar Lançamentos Selecionados
                                </>
                            )}
                        </button>
                    </div>

                    {ddaPreview.newRecords.length > 0 && (
                        <div className="card" style={{ marginBottom: '2rem' }}>
                            <h4><AlertCircle size={16} /> Lançamentos Novos (Não Constam)</h4>
                            <div className="table-container" style={{ marginTop: '1rem' }}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Data</th>
                                            <th>Fornecedor</th>
                                            <th>Observação</th>
                                            <th className="th-right">Valor</th>
                                            <th style={{ textAlign: 'right' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ddaPreview.newRecords.map((r, i) => (
                                            <tr key={`new-${i}`} style={{ opacity: r.action === 'ignored' ? 0.4 : 1 }}>
                                                <td className="date-cell">{r.vencimento}</td>
                                                <td>{r.nome}</td>
                                                <td>
                                                    <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)', fontWeight: 600 }}>
                                                        {r.observacao}
                                                    </span>
                                                </td>
                                                <td className="value-cell">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                        {r.action !== 'insert' ? (
                                                            <button onClick={() => handleDDAAction(r._id, 'insert', 'newRecords')} style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Inserir</button>
                                                        ) : (
                                                            <button onClick={() => handleDDAAction(r._id, 'pending', 'newRecords')} style={{ background: 'var(--color-success)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12} /> Confirmado</button>
                                                        )}
                                                        <button onClick={() => handleDDAAction(r._id, 'delete', 'newRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Ignorar Boleto</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {ddaPreview.divergentRecords.length > 0 && (
                        <div className="card" style={{ marginBottom: '2rem', border: '1px solid var(--color-warning)' }}>
                            <h4><AlertTriangle size={16} color="var(--color-warning)" /> Divergências Encontradas</h4>
                            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>Valores ou datas próximos, mas com diferenças em relação ao banco de dados.</p>
                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Detalhes DDA</th>
                                            <th>Detalhes Banco de Dados</th>
                                            <th style={{ textAlign: 'right' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ddaPreview.divergentRecords.map((r, i) => (
                                            <tr key={`div-${i}`}>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                                        <strong style={{ display: 'inline' }}>{r.vencimento} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</strong>
                                                        <span style={{ fontSize: '0.7rem', padding: '1px 4px', borderRadius: '3px', background: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}>{r.observacao}</span>
                                                    </div>
                                                    <span style={{ fontSize: '0.85em', color: 'var(--color-text-muted)' }}>{r.nome}</span>
                                                </td>
                                                <td style={{ opacity: 0.7 }}>
                                                    <strong style={{ display: 'block' }}>{parseDateString(r.baseMatch.vencimento).split('-').reverse().join('/')} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.baseMatch.valor)}</strong>
                                                    <span style={{ fontSize: '0.85em' }}>{r.baseMatch.nome}</span>
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                        {r.action !== 'insert' ? (
                                                            <button onClick={() => handleDDAAction(r._id, 'insert', 'divergentRecords')} style={{ background: 'var(--color-warning)', color: 'black', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Substituir (Aceitar DDA)</button>
                                                        ) : (
                                                            <button onClick={() => handleDDAAction(r._id, 'pending', 'divergentRecords')} style={{ background: 'var(--color-success)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', display:'flex', alignItems:'center', gap:'4px' }}><CheckCircle2 size={12} /> Substituído</button>
                                                        )}
                                                        <button onClick={() => handleDDAAction(r._id, 'unlink', 'divergentRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }} title="Remover vinculo e tratar como Novo DDA">Não é este boleto</button>
                                                        <button onClick={() => handleDDAAction(r._id, 'delete', 'divergentRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-danger)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Ignorar Boleto</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {ddaPreview.exactRecords.length > 0 && (
                        <div className="card" style={{ opacity: 0.7 }}>
                            <h4><CheckCircle2 size={16} color="var(--color-success)" /> Já Conciliados</h4>
                            <div className="table-container" style={{ marginTop: '1rem' }}>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Data</th>
                                            <th>Fornecedor</th>
                                            <th>Unidade</th>
                                            <th className="th-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ddaPreview.exactRecords.map((r, i) => (
                                            <tr key={`exact-${i}`}>
                                                <td className="date-cell">{r.vencimento}</td>
                                                <td>{r.nome}</td>
                                                <td>{r.observacao}</td>
                                                <td className="value-cell">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                        <button
                            onClick={() => setDdaPreview(null)}
                            style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}
                        >
                            Importar Novos Dados DDA
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportacaoDDA;
