import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import ImageUploader from './ImageUploader';
import ReviewTable from './ReviewTable';
import { PlusCircle, Filter, Trash2, Edit2, Save, X, Database } from 'lucide-react';

const AdminExpenses = ({ userEmail }) => {
    const [expenses, setExpenses] = useState([]);
    const [classFilter, setClassFilter] = useState('');
    const [ocrData, setOcrData] = useState(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    
    const initialForm = { id: null, vencimento: '', classificacao: 'COMPRAS', nome: '', descricao: '', valor: '', observacao: '' };
    const [formData, setFormData] = useState(initialForm);

    useEffect(() => {
        fetchExpenses();
        const channel = supabase.channel('admin_payments_view')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
                fetchExpenses();
            })
            .subscribe();
        return () => supabase.removeChannel(channel);
    }, []);

    const fetchExpenses = async () => {
        const { data, error } = await supabase
            .from('payments')
            .select('*');
        if (!error && data) {
            const sorted = data.sort((a, b) => {
                const classA = a.classificacao || 'Z_UNCLASSIFIED';
                const classB = b.classificacao || 'Z_UNCLASSIFIED';
                if (classA < classB) return -1;
                if (classA > classB) return 1;
                return (a.vencimento || '').localeCompare(b.vencimento || '');
            });
            setExpenses(sorted);
        }
    };

    const filteredExpenses = useMemo(() => {
        let res = expenses;
        if (classFilter) {
            res = res.filter(e => e.classificacao === classFilter);
        } else {
            const valid = ['COMPRAS', 'OUTROS', 'TERCEIROS', 'URGENTE', 'URGENTES'];
            res = res.filter(e => e.classificacao && valid.includes(e.classificacao.toUpperCase().trim()));
        }
        return res;
    }, [expenses, classFilter]);

    const handleSaveForm = async (e) => {
        e.preventDefault();
        const payload = {
            vencimento: formData.vencimento,
            classificacao: formData.classificacao.toUpperCase(),
            nome: formData.nome,
            descricao: formData.descricao,
            valor: parseFloat(formData.valor) || 0,
            observacao: formData.observacao,
            source: 'manual_admin'
        };

        if (formData.id) {
            await supabase.from('payments').update(payload).eq('id', formData.id);
        } else {
            await supabase.from('payments').insert([payload]);
        }
        
        setFormData(initialForm);
        setIsFormOpen(false);
    };

    const handleEdit = (item) => {
        setFormData({ ...item });
        setIsFormOpen(true);
    };

    const handleDelete = async (id) => {
        if(window.confirm('Certeza absoluta que deseja excluir este lançamento? Esta ação não pode ser desfeita.')) {
            await supabase.from('payments').delete().eq('id', id);
        }
    };

    const handleOcrData = (data) => {
        setOcrData(data);
    };

    const handleOcrSuccess = (count) => {
        setOcrData(null);
    };

    if (ocrData) {
        return <ReviewTable initialData={ocrData} onCancel={() => setOcrData(null)} onSuccess={handleOcrSuccess} />;
    }

    if (userEmail !== 'pedro.gui.fialho@gmail.com') {
        return <div className="card text-center" style={{ color: 'var(--color-danger)' }}>Acesso Negado: Apenas gestores autorizados.</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div className="card">
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', color: 'var(--color-warning)' }}>
                    <Database size={24} /> 
                    Gestão Restrita de Despesas Auxiliares
                </h2>
                <p className="text-muted" style={{ marginBottom: '2rem' }}>
                    Esta aba exibe e gerencia **apenas** pagamentos das classificações (Compras, Outros, Terceiros, Urgente). Todos os itens criados aqui serão espelhados normalmente no Dashboard Geral.
                </p>
                
                <ImageUploader onExtractedData={handleOcrData} />
                
                <hr style={{ margin: '2rem 0', borderColor: 'var(--color-border)' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <div className="input-icon-wrapper" style={{ minWidth: '250px' }}>
                            <Filter size={18} />
                            <select 
                                className="input-with-icon" 
                                value={classFilter} 
                                onChange={(e) => setClassFilter(e.target.value)}
                                style={{ paddingLeft: '2.5rem', cursor: 'pointer' }}
                            >
                                <option value="">Todas as 4 Classificações</option>
                                <option value="COMPRAS">COMPRAS</option>
                                <option value="TERCEIROS">TERCEIROS</option>
                                <option value="URGENTE">URGENTE / URGENTES</option>
                                <option value="OUTROS">OUTROS</option>
                            </select>
                        </div>
                    </div>

                    <button className="action-btn" onClick={() => { setFormData(initialForm); setIsFormOpen(true); }} style={{ background: 'var(--color-success)', color: 'white', borderColor: 'var(--color-success)' }}>
                        <PlusCircle size={18} /> Inserção Manual
                    </button>
                </div>

                {isFormOpen && (
                    <div className="card" style={{ marginBottom: '2rem', border: '1px solid var(--color-success)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <h3>{formData.id ? 'Editar Despesa Manual' : 'Nova Despesa Manual'}</h3>
                            <button onClick={() => setIsFormOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}><X size={20} /></button>
                        </div>
                        <form onSubmit={handleSaveForm} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                            <div className="input-group">
                                <label>Classificação *</label>
                                <select value={formData.classificacao} onChange={e => setFormData({...formData, classificacao: e.target.value})} required>
                                    <option value="COMPRAS">COMPRAS</option>
                                    <option value="TERCEIROS">TERCEIROS</option>
                                    <option value="URGENTE">URGENTE</option>
                                    <option value="OUTROS">OUTROS</option>
                                </select>
                            </div>
                            <div className="input-group">
                                <label>Vencimento (DD/MM/YYYY) *</label>
                                <input type="text" value={formData.vencimento} onChange={e => setFormData({...formData, vencimento: e.target.value})} required placeholder="Ex: 14/03/2026" />
                            </div>
                            <div className="input-group">
                                <label>Nome/Fornecedor *</label>
                                <input type="text" value={formData.nome} onChange={e => setFormData({...formData, nome: e.target.value})} required />
                            </div>
                            <div className="input-group">
                                <label>Descrição</label>
                                <input type="text" value={formData.descricao} onChange={e => setFormData({...formData, descricao: e.target.value})} />
                            </div>
                            <div className="input-group">
                                <label>Valor Numérico (Float) *</label>
                                <input type="number" step="0.01" value={formData.valor} onChange={e => setFormData({...formData, valor: e.target.value})} required placeholder="1500.50" />
                            </div>
                            <div className="input-group" style={{ gridColumn: '1 / -1' }}>
                                <label>Observação / Forma Pagamento</label>
                                <input type="text" value={formData.observacao} onChange={e => setFormData({...formData, observacao: e.target.value})} placeholder="Pix, Boleto, etc." />
                            </div>
                            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                                <button type="button" onClick={() => setIsFormOpen(false)} className="btn-secondary">Cancelar</button>
                                <button type="submit" className="action-btn" style={{ background: 'var(--color-success)', color: 'white', borderColor: 'var(--color-success)' }}><Save size={18} /> Salvar no BD</button>
                            </div>
                        </form>
                    </div>
                )}

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: '120px' }}>Classificação</th>
                                <th>Vencimento</th>
                                <th>Fornecedor</th>
                                <th>Descrição/Obs.</th>
                                <th style={{ textAlign: 'right' }}>Valor</th>
                                <th style={{ textAlign: 'center', width: '100px' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredExpenses.map((item) => (
                                <tr key={item.id}>
                                    <td>
                                        <span className="badge badge-dda" style={{ 
                                            background: 'var(--color-bg-elevated)', 
                                            color: 'var(--color-accent)', 
                                            border: '1px solid var(--color-accent-subtle)',
                                            fontWeight: 600
                                        }}>
                                            {item.classificacao}
                                        </span>
                                    </td>
                                    <td className="date-cell">{item.vencimento}</td>
                                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                                    <td style={{ fontSize: '0.85rem' }}>
                                        <strong style={{ display: 'block' }}>{item.descricao}</strong>
                                        <span style={{ color: 'var(--color-text-muted)' }}>{item.observacao}</span>
                                    </td>
                                    <td className="value-cell">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor)}</td>
                                    <td style={{ textAlign: 'center' }}>
                                        <button onClick={() => handleEdit(item)} title="Editar" style={{ background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', margin: '0 0.5rem' }}><Edit2 size={18} /></button>
                                        <button onClick={() => handleDelete(item.id)} title="Excluir" style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={18} /></button>
                                    </td>
                                </tr>
                            ))}
                            {filteredExpenses.length === 0 && (
                                <tr>
                                    <td colSpan="6" style={{ textAlign: 'center', padding: '3rem' }} className="text-muted">
                                        Nenhuma despesa administrativa (Compras, Terceiros, Urgente) foi encontrada ou criada ainda.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AdminExpenses;
