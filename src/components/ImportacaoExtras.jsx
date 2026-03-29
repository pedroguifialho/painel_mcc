import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { parseCurrency, formatExcelDate } from '../lib/utils';
import { UploadCloud, CheckCircle2, Save, X, Edit2, Loader2, ListPlus } from 'lucide-react';
import * as XLSX from 'xlsx';

const ImportacaoExtras = ({ onImportSuccess }) => {
    const [pastedData, setPastedData] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSavingInProgress, setIsSavingInProgress] = useState(false);
    
    // previewRecords: array of mapped objects ready for display & edit
    const [previewRecords, setPreviewRecords] = useState(null);

    // 1st Method: Paste from Clipboard (Tab-separated)
    const handlePasteImport = () => {
        if (!pastedData.trim()) return alert('Cole os dados primeiro.');
        setIsProcessing(true);

        setTimeout(() => {
            const lines = pastedData.split('\n').filter(l => l.trim());
            const parsed = [];

            for (let i = 0; i < lines.length; i++) {
                const row = lines[i].split('\t');
                // Minimum expected columns logic
                if (row.length >= 5) {
                    parsed.push({
                        _id: `paste_${Date.now()}_${i}`,
                        data_movimento: row[0] ? row[0].trim() : '',
                        classificacao: row[1] ? row[1].trim() : '',
                        descricao: row[2] ? row[2].trim() : '',
                        nome: row[3] ? row[3].trim() : '',
                        valor: parseCurrency(row[4]),
                        vencimento: row[5] ? row[5].trim() : '',
                        observacao: row[6] ? row[6].trim() : '',
                    });
                }
            }

            if (parsed.length === 0) {
                alert('Não foi possível identificar linhas com dados válidos. Verifique a formatação.');
            } else {
                setPreviewRecords(parsed);
                setPastedData('');
            }
            setIsProcessing(false);
        }, 300);
    };

    // 2nd Method: Excel file upload
    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsProcessing(true);
        const reader = new FileReader();

        reader.onload = (event) => {
            try {
                const data = new Uint8Array(event.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                // Convert to JSON array of arrays (header: 1 forces it to arrays rather than objects to avoid key mismatch)
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                
                const parsed = [];
                // Assuming first row might be headers, skip it if it doesn't look like money data.
                // We will just try to parse every row that has at least 5 cols.
                // Or safely assume first row is header and skip it:
                const startIdx = jsonData.length > 0 && isNaN(parseCurrency(jsonData[0][4])) ? 1 : 0;

                for (let i = startIdx; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (row && row.length >= 5) {
                        parsed.push({
                            _id: `excel_${Date.now()}_${i}`,
                            data_movimento: formatExcelDate(row[0]),
                            classificacao: String(row[1] || '').trim(),
                            descricao: String(row[2] || '').trim(),
                            nome: String(row[3] || '').trim(),
                            valor: parseCurrency(row[4]),
                            vencimento: formatExcelDate(row[5]),
                            observacao: String(row[6] || '').trim(),
                        });
                    }
                }

                if (parsed.length === 0) {
                    alert('Não foi possível extrair dados válidos. Certifique-se que o Excel segue o formato esperado.');
                } else {
                    setPreviewRecords(parsed);
                }
            } catch (err) {
                console.error(err);
                alert('Erro ao processar o arquivo Excel.');
            } finally {
                setIsProcessing(false);
            }
        };

        reader.readAsArrayBuffer(file);
        e.target.value = null; // Reset
    };

    // Form Handling in Preview
    const updateRecord = (id, field, value) => {
        setPreviewRecords(prev => prev.map(rec => rec._id === id ? { ...rec, [field]: value } : rec));
    };

    const removeRecord = (id) => {
        setPreviewRecords(prev => prev.filter(rec => rec._id !== id));
    };

    // Consolidation (Save to Supabase)
    const saveToBackend = async () => {
        if (!previewRecords || previewRecords.length === 0) return;

        // Perform basic validation
        const invalid = previewRecords.find(r => !r.nome || !r.vencimento || r.valor <= 0);
        if (invalid) {
            return alert('Existem lançamentos com campos vazios (Fornecedor ou Vencimento) ou Valor zerado/inválido. Corrija antes de importar.');
        }

        setIsSavingInProgress(true);

        try {
            const payload = previewRecords.map(r => ({
                data_movimento: r.data_movimento,
                classificacao: r.classificacao,
                descricao: r.descricao,
                nome: r.nome,
                valor: parseFloat(r.valor),
                vencimento: r.vencimento,
                observacao: r.observacao,
                source: 'native' // Marking it as native since it sits alongside general data
            }));

            // Insert operation
            const { error } = await supabase
                .from('payments')
                .insert(payload);
                
            if (error) throw error;

            alert(`${payload.length} lançamentos importados com sucesso!`);
            setPreviewRecords(null);
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
            <h2 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ListPlus size={24} style={{ color: 'var(--color-primary)' }}/> Importação de Extras
            </h2>
            <p className="text-muted" style={{ marginBottom: '2rem' }}>
                Utilize esta área para adicionar novos lançamentos (via arquivo Excel ou colando os dados). 
                A planilha deve ter colunas idênticas à geral, porém a <strong style={{color: 'var(--color-text-base)'}}>Segunda Coluna indica a Classificação.</strong>
            </p>

            {!previewRecords ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '2rem', alignItems: 'stretch' }}>
                    {/* Method 1: Dropzone Excel */}
                    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Upload Excel (.xlsx, .xls)</h3>
                        <label className="dropzone" style={{ flex: 1, minHeight: '180px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                            {isProcessing ? <Loader2 size={48} className="animate-spin" /> : <UploadCloud size={48} />}
                            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
                                <span style={{ fontWeight: 600, display: 'block', color: 'var(--color-text-base)' }}>Clique ou arraste a planilha</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Formatos .xlsx ou .xls</span>
                            </div>
                            <input
                                type="file"
                                accept=".xlsx, .xls, .csv"
                                onChange={handleFileUpload}
                                style={{ display: 'none' }}
                                disabled={isProcessing}
                            />
                        </label>
                    </div>

                    {/* Method 2: Paste data */}
                    <div style={{ background: 'var(--color-bg-elevated)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', border: '1px solid var(--color-border)' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>Colar Dados de Tabela</h3>
                        <textarea
                            value={pastedData}
                            onChange={(e) => setPastedData(e.target.value)}
                            placeholder="Copie as células do Excel e cole aqui..."
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
                                fontSize: '0.85rem',
                                whiteSpace: 'pre' // Keeps tabs intact better sometimes
                            }}
                            disabled={isProcessing}
                        />
                        <button 
                            onClick={handlePasteImport} 
                            disabled={!pastedData.trim() || isProcessing}
                            className="btn btn-primary"
                            style={{ marginTop: '1rem', alignSelf: 'flex-end' }}
                        >
                            {isProcessing ? 'Processando...' : 'Processar Texto'}
                        </button>
                    </div>
                </div>
            ) : (
                // PREVIEW UI
                <div>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <div>
                            <h3 style={{ fontSize: '1.25rem' }}>Revisão de Dados Extras</h3>
                            <p className="text-muted">
                                Total de linhas processadas: <strong>{previewRecords.length}</strong>. 
                                Faça ajustes necessários antes de confirmar.
                            </p>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                             <button
                                className="action-btn"
                                onClick={() => setPreviewRecords(null)}
                                style={{ background: 'transparent', border: '1px solid var(--color-border)', color: 'var(--color-text-muted)' }}
                                disabled={isSavingInProgress}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={saveToBackend}
                                disabled={isSavingInProgress || previewRecords.length === 0}
                            >
                                {isSavingInProgress ? 'Salvando...' : (
                                    <>
                                        <Save size={18} /> Confirmar Importação
                                    </>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="table-container" style={{ border: '1px solid var(--color-border)', borderRadius: '8px' }}>
                        <table>
                            <thead>
                                <tr>
                                    <th style={{width: '90px'}}>Movimento</th>
                                    <th style={{width: '120px'}}>Classificação</th>
                                    <th>Descrição</th>
                                    <th>Fornecedor</th>
                                    <th style={{width: '100px'}} className="th-right">Valor</th>
                                    <th style={{width: '90px'}}>Vencimento</th>
                                    <th>Observações</th>
                                    <th style={{ width: '50px', textAlign: 'center' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {previewRecords.map((r) => (
                                    <tr key={r._id}>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="text" value={r.data_movimento} onChange={(e) => updateRecord(r._id, 'data_movimento', e.target.value)} style={{ width: '100%', padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="text" value={r.classificacao} onChange={(e) => updateRecord(r._id, 'classificacao', e.target.value)} style={{ width: '100%', padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="text" value={r.descricao} onChange={(e) => updateRecord(r._id, 'descricao', e.target.value)} style={{ width: '100%', padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="text" value={r.nome} onChange={(e) => updateRecord(r._id, 'nome', e.target.value)} style={{ width: '100%', padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="number" step="0.01" value={r.valor} onChange={(e) => updateRecord(r._id, 'valor', parseFloat(e.target.value) || 0)} style={{ width: '100%', textAlign: 'right', padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="text" value={r.vencimento} onChange={(e) => updateRecord(r._id, 'vencimento', e.target.value)} style={{ width: '100%', padding: '0.25rem', border: '1px solid ${r.vencimento ? "var(--color-border)" : "var(--color-danger)"}', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ padding: '0.25rem 0.5rem' }}>
                                            <input type="text" value={r.observacao} onChange={(e) => updateRecord(r._id, 'observacao', e.target.value)} style={{ width: '100%', padding: '0.25rem', border: '1px solid var(--color-border)', borderRadius: '4px', background: 'transparent', color: 'inherit', fontSize: '0.8rem' }}/>
                                        </td>
                                        <td style={{ textAlign: 'center', padding: '0.25rem 0.5rem' }}>
                                            <button onClick={() => removeRecord(r._id)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Remover Linha">
                                                <X size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {previewRecords.length === 0 && (
                                    <tr>
                                        <td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-muted)' }}>
                                            Todos os registros removidos.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImportacaoExtras;
