import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { UploadCloud, CheckCircle2, AlertCircle, AlertTriangle, FilterX, Save } from 'lucide-react';

const parseDateString = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('/');
    if (parts.length !== 3) return '';
    return `${parts[2]}-${parts[1]}-${parts[0]}`; // YYYY-MM-DD
};

const parseCurrency = (valStr) => {
    if (!valStr) return 0;
    let str = String(valStr).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
    return parseFloat(str) || 0;
};

const ImportacaoDDA = ({ baseData, onImportSuccess }) => {
    const [isProcessingFile, setIsProcessingFile] = useState(false);
    const [isSavingInProgress, setIsSavingInProgress] = useState(false);
    const [ddaPreview, setDdaPreview] = useState(null);

    const [ddaIgnoredSuppliers, setDdaIgnoredSuppliers] = useState(() => {
        try { return JSON.parse(localStorage.getItem('ddaIgnoredSuppliers') || '[]'); }
        catch { return []; }
    });

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsProcessingFile(true);
        const reader = new FileReader();

        reader.onload = (event) => {
            const text = event.target.result;
            processDDAText(text);
        };

        reader.readAsText(file);
        e.target.value = null; // Reset input
    };

    const processDDAText = (text) => {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');

        if (lines.length < 6) {
            setIsProcessingFile(false);
            alert('Formato de arquivo inválido. O arquivo DDA deve ter dados a partir da linha 6.');
            return;
        }

        const importedRecords = [];

        // Data starts from index 5 (6th line). 
        for (let i = 5; i < lines.length; i++) {
            const values = lines[i].split(';');

            let vencimento = values[0] ? values[0].trim() : '';
            let nome = values[1] ? values[1].trim().toUpperCase() : '';
            let valorStr = values[4] ? values[4].trim() : '';

            // Ignore the "Total" line at the bottom
            if (!vencimento || vencimento.toLowerCase().includes('total')) continue;

            const data_iso = parseDateString(vencimento);
            if (!data_iso) continue; // Skip invalid dates

            const valor = parseCurrency(valorStr);
            if (valor <= 0) continue; // Skip zero or invalid values

            // Generate a unique transient ID for UI tracking
            const tempId = 'id_' + i + '_' + Date.now();

            importedRecords.push({
                _id: tempId,
                vencimento,
                nome: nome || 'FORNECEDOR DDA NÃO IDENTIF.',
                descricao: 'BOLETO DDA IMPORTADO',
                observacao: 'IMPORTADO AUTOMATICAMENTE (DDA)',
                valor,
                data_iso,
                action: 'pending', // 'pending', 'insert', 'ignore', 'edit'
            });
        }

        // Filter out those present in global ignore list
        const filteredRecords = importedRecords.filter(r => !ddaIgnoredSuppliers.includes(r.nome));
        compareDDAWithBase(filteredRecords);
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
                Faça o upload do relatório extraído do banco (arquivo CSV). Iremos comparar com a base do sistema para evitar pagamentos duplicados.
            </p>

            {!ddaPreview ? (
                <label className="dropzone">
                    <UploadCloud size={48} />
                    <div>
                        <h3 style={{ color: 'var(--color-text-base)' }}>Clique para anexar arquivo</h3>
                        <span className="text-muted">Apenas formato .csv (separado por ponto e vírgula)</span>
                    </div>
                    <input
                        type="file"
                        accept=".csv"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                        disabled={isProcessingFile}
                    />
                    {isProcessingFile && <div style={{ marginTop: '1rem' }}>Processando arquivo...</div>}
                </label>
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
                                            <th className="th-right">Valor</th>
                                            <th style={{ textAlign: 'right' }}>Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ddaPreview.newRecords.map((r, i) => (
                                            <tr key={`new-${i}`} style={{ opacity: r.action === 'ignored' ? 0.4 : 1 }}>
                                                <td className="date-cell">{r.vencimento}</td>
                                                <td>{r.nome}</td>
                                                <td className="value-cell">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                                                        {r.action !== 'insert' ? (
                                                            <button onClick={() => handleDDAAction(r._id, 'insert', 'newRecords')} style={{ background: 'var(--color-accent)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Inserir</button>
                                                        ) : (
                                                            <button onClick={() => handleDDAAction(r._id, 'pending', 'newRecords')} style={{ background: 'var(--color-success)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle2 size={12} /> Confirmado</button>
                                                        )}
                                                        <button onClick={() => handleDDAAction(r._id, 'delete', 'newRecords')} style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}>Ignorar Boleto</button>
                                                        <button onClick={() => handleIgnoreSupplier(r.nome)} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--color-danger)', color: 'white', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }} title={`Ignorar permanentemente fornecedor: ${r.nome}`}><FilterX size={12} /> Ignorar Sempre</button>
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
                                                    <strong style={{ display: 'block' }}>{r.vencimento} - {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(r.valor)}</strong>
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
                                            <th className="th-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ddaPreview.exactRecords.map((r, i) => (
                                            <tr key={`exact-${i}`}>
                                                <td className="date-cell">{r.vencimento}</td>
                                                <td>{r.nome}</td>
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
                            Carregar Outro Arquivo DDA
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportacaoDDA;
