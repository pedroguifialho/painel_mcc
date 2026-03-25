import React, { useState, useEffect } from 'react';
import { Trash2, Save, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

const ReviewTable = ({ initialData, onCancel, onSuccess }) => {
    const [tableData, setTableData] = useState([]);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        // Garantir ID temporário para lista no React
        setTableData(initialData.map((row, idx) => ({ ...row, _tmpId: Date.now() + idx })));
    }, [initialData]);

    const handleCellChange = (id, field, value) => {
        setTableData(prev => prev.map(row => 
            row._tmpId === id ? { ...row, [field]: value } : row
        ));
    };

    const handleDeleteRow = (id) => {
        setTableData(prev => prev.filter(row => row._tmpId !== id));
    };

    const handleConfirmSave = async () => {
        if (tableData.length === 0) return alert('Nenhum dado sobrou para salvar.');
        setIsSaving(true);
        try {
            const payload = tableData.map(r => ({
                vencimento: r.vencimento,
                classificacao: (r.classificacao || 'OUTROS').toUpperCase().trim(),
                descricao: r.descricao || '',
                nome: r.nome || 'N/A',
                valor: parseFloat(r.valor) || 0,
                observacao: r.observacao || 'Inserido via IA',
                source: 'image_import'
            }));

            const { error } = await supabase.from('payments').insert(payload);
            if (error) throw error;
            
            onSuccess(payload.length);
        } catch (err) {
            console.error(err);
            alert("Erro ao inserir no Supabase: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (tableData.length === 0) {
        return (
             <div className="card text-center" style={{ marginTop: '2rem' }}>
                 <p className="text-muted">A tabela está vazia. Todos os itens apagados ou IA não captou nada.</p>
                 <button onClick={onCancel} className="btn-secondary" style={{ marginTop: '1rem' }}>Voltar</button>
             </div>
        );
    }

    return (
        <div className="card" style={{ marginTop: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h3 style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--color-warning)' }}>
                    <AlertCircle size={24} />
                    Revise as colunas capturadas!
                </h3>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button onClick={onCancel} className="btn-secondary" disabled={isSaving}>Cancelar</button>
                    <button onClick={handleConfirmSave} className="action-btn update-btn" disabled={isSaving} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Save size={18} /> {isSaving ? 'Salvando...' : 'Confirmar e Inserir no DB'}
                    </button>
                </div>
            </div>
            
            <p className="text-muted" style={{ marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                A IA pode falhar na interpretação de caracteres difíceis. Altere os valores numéricos com um simples clique nos campos se observar erros (Vírgulas foram convertidas em ponto).
            </p>

            <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th>Classificação</th>
                            <th>Vencimento</th>
                            <th>Nome/Fornecedor</th>
                            <th>Descrição</th>
                            <th>Valor (Numérico)</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tableData.map(row => (
                            <tr key={row._tmpId}>
                                <td>
                                    <input className="input-with-icon" type="text" value={row.classificacao} onChange={(e) => handleCellChange(row._tmpId, 'classificacao', e.target.value)} style={{ padding: '0.3rem', width: '120px' }} />
                                </td>
                                <td>
                                    <input className="input-with-icon" type="text" value={row.vencimento} onChange={(e) => handleCellChange(row._tmpId, 'vencimento', e.target.value)} style={{ padding: '0.3rem', width: '90px' }} />
                                </td>
                                <td>
                                    <input className="input-with-icon" type="text" value={row.nome} onChange={(e) => handleCellChange(row._tmpId, 'nome', e.target.value)} style={{ padding: '0.3rem', width: '100%' }} />
                                </td>
                                <td>
                                    <input className="input-with-icon" type="text" value={row.descricao} onChange={(e) => handleCellChange(row._tmpId, 'descricao', e.target.value)} style={{ padding: '0.3rem', width: '100%' }} />
                                </td>
                                <td>
                                    <input className="input-with-icon" type="number" step="0.01" value={row.valor} onChange={(e) => handleCellChange(row._tmpId, 'valor', e.target.value)} style={{ padding: '0.3rem', width: '100px' }} />
                                </td>
                                <td>
                                    <button onClick={() => handleDeleteRow(row._tmpId)} title="Apagar linha incorreta" style={{ color: 'var(--color-danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.2rem' }}>
                                        <Trash2 size={20} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ReviewTable;
