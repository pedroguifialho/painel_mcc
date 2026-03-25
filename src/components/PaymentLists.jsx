import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { 
    Trash2, 
    Download, 
    CheckCircle2, 
    Circle, 
    ChevronLeft, 
    ListChecks, 
    Wallet, 
    TrendingDown,
    PlusCircle,
    XCircle,
    FileText
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PaymentLists = ({ user }) => {
    const [lists, setLists] = useState([]);
    const [selectedList, setSelectedList] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const fetchLists = useCallback(async () => {
        setIsLoading(true);
        const { data, error } = await supabase
            .from('payment_lists')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching lists:', error);
        } else {
            setLists(data || []);
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        fetchLists();
    }, [fetchLists]);

    const handleDeleteList = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm("Tem certeza que deseja excluir esta lista?")) return;

        try {
            const { error } = await supabase.from('payment_lists').delete().eq('id', id);
            if (error) throw error;
            fetchLists();
            if (selectedList?.id === id) setSelectedList(null);
        } catch (error) {
            alert("Erro ao excluir lista: " + error.message);
        }
    };

    const handleUpdateItemStatus = async (itemIndex, isPaid) => {
        if (!selectedList) return;

        const updatedItems = [...selectedList.items];
        updatedItems[itemIndex].paid = isPaid;

        try {
            const { error } = await supabase
                .from('payment_lists')
                .update({ items: updatedItems })
                .eq('id', selectedList.id);

            if (error) throw error;
            
            const updatedList = { ...selectedList, items: updatedItems };
            setSelectedList(updatedList);
            // Also update in the main array
            setLists(lists.map(l => l.id === selectedList.id ? updatedList : l));
        } catch (error) {
            alert("Erro ao atualizar item: " + error.message);
        }
    };

    const handleRemoveItem = async (itemIndex) => {
        if (!selectedList) return;
        if (!window.confirm("Remover este item da lista?")) return;

        const updatedItems = selectedList.items.filter((_, idx) => idx !== itemIndex);

        try {
            const { error } = await supabase
                .from('payment_lists')
                .update({ items: updatedItems })
                .eq('id', selectedList.id);

            if (error) throw error;
            
            const updatedList = { ...selectedList, items: updatedItems };
            setSelectedList(updatedList);
            setLists(lists.map(l => l.id === selectedList.id ? updatedList : l));
        } catch (error) {
            alert("Erro ao remover item: " + error.message);
        }
    };

    const handleUpdateAvailableAmount = async (val) => {
        if (!selectedList) return;
        const amount = parseFloat(val) || 0;

        try {
            const { error } = await supabase
                .from('payment_lists')
                .update({ available_amount: amount })
                .eq('id', selectedList.id);

            if (error) throw error;
            
            const updatedList = { ...selectedList, available_amount: amount };
            setSelectedList(updatedList);
            setLists(lists.map(l => l.id === selectedList.id ? updatedList : l));
        } catch (error) {
            console.error("Erro ao atualizar valor disponível:", error);
        }
    };

    const stats = useMemo(() => {
        if (!selectedList) return null;
        const total = selectedList.items.reduce((acc, curr) => acc + (curr.valor || 0), 0);
        const paid = selectedList.items.filter(i => i.paid).reduce((acc, curr) => acc + (curr.valor || 0), 0);
        const pending = total - paid;
        const balance = selectedList.available_amount - pending;
        
        return { total, paid, pending, balance };
    }, [selectedList]);

    const exportToPDF = () => {
        if (!selectedList) return;

        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true,
            compress: true
        });
        
        const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
        const safe = (str) => (str || '').normalize('NFC');
        const dateNow = new Date().toLocaleDateString('pt-BR');

        // --- Header Design ---
        doc.setFontSize(20);
        doc.setTextColor(234, 88, 12); // Accent Orange
        doc.text('Lista de Pagamentos - MCC', 14, 22);
        
        doc.setFontSize(14);
        doc.setTextColor(40);
        doc.text(safe(selectedList.name), 14, 30);
        
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`Gerada em: ${new Date(selectedList.created_at).toLocaleDateString('pt-BR')}`, 14, 38);
        doc.text(`Disponível: ${fmt(selectedList.available_amount)}`, 14, 43);

        // --- Summary Table ---
        autoTable(doc, {
            startY: 50,
            head: [['Resumo Financeiro da Lista', 'Valor']],
            body: [
                ['Total da Seleção', fmt(stats.total)],
                ['Total Pago (Checklist)', fmt(stats.paid)],
                ['Total Pendente', fmt(stats.pending)],
                [{ content: 'SALDO FINAL (Disponível - Pendente)', styles: { fontStyle: 'bold' } }, { content: fmt(stats.balance), styles: { fontStyle: 'bold', textColor: stats.balance >= 0 ? [16, 185, 129] : [239, 68, 68] } }]
            ],
            theme: 'grid',
            headStyles: { fillColor: [59, 130, 246], fontSize: 10 },
            styles: { fontSize: 9, cellPadding: 3 },
            columnStyles: { 1: { halign: 'right' } },
            margin: { left: 14, right: 14 }
        });

        // --- Items Table ---
        const tableRows = selectedList.items.map(item => [
            item.paid ? '[OK]' : '[  ]',
            safe(item.vencimento),
            safe(item.nome),
            safe(item.descricao) + (item.documento ? `\n[${item.documento}]` : ''),
            fmt(item.valor)
        ]);

        autoTable(doc, {
            startY: doc.lastAutoTable.finalY + 12,
            head: [['Status', 'Vencimento', 'Fornecedor', 'Descrição / Doc', 'Valor']],
            body: tableRows,
            theme: 'striped',
            headStyles: { fillColor: [234, 88, 12], fontSize: 9 },
            styles: { fontSize: 8, valign: 'middle', overflow: 'linebreak' },
            columnStyles: { 
                0: { cellWidth: 15, halign: 'center' },
                1: { cellWidth: 25, halign: 'center' },
                4: { cellWidth: 30, halign: 'right' } 
            },
            margin: { left: 14, right: 14 },
            didDrawPage: (data) => {
                doc.setFontSize(7);
                doc.setTextColor(150);
                doc.text(`Página ${doc.internal.getNumberOfPages()}`, 14, doc.internal.pageSize.height - 10);
            }
        });

        doc.save(`lista_${selectedList.name.toLowerCase().replace(/\s+/g, '_')}_${dateNow}.pdf`);
    };

    if (isLoading) {
        return (
            <div className="empty-state">
                <p>Carregando listas...</p>
            </div>
        );
    }

    if (selectedList) {
        return (
            <div className="payment-list-details">
                <button 
                    onClick={() => setSelectedList(null)}
                    className="btn btn-secondary"
                    style={{ marginBottom: '1.5rem', alignSelf: 'flex-start' }}
                >
                    <ChevronLeft size={18} />
                    Voltar para Listas
                </button>

                <div className="card" style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{selectedList.name}</h2>
                            <p className="text-muted" style={{ margin: 0 }}>Criada em {new Date(selectedList.created_at).toLocaleDateString('pt-BR')}</p>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button className="btn btn-primary" onClick={exportToPDF}>
                                <Download size={18} />
                                Exportar PDF
                            </button>
                        </div>
                    </div>
                </div>

                <div className="grid" style={{ marginBottom: '2rem' }}>
                    <div className="card">
                        <div className="stat-header">
                            <Wallet size={18} className="stat-icon" style={{ color: 'var(--color-accent)' }} />
                            <div className="stat-label">Valor Disponível</div>
                        </div>
                        <input 
                            type="number" 
                            className="stat-value"
                            style={{ 
                                background: 'transparent', 
                                border: 'none', 
                                borderBottom: '2px solid var(--color-accent)',
                                width: '100%',
                                fontSize: '1.75rem',
                                padding: '0.25rem 0',
                                color: 'var(--color-text-base)',
                                fontWeight: 700
                            }}
                            value={selectedList.available_amount}
                            onChange={(e) => handleUpdateAvailableAmount(e.target.value)}
                        />
                    </div>

                    <div className="card">
                        <div className="stat-header">
                            <TrendingDown size={18} className="stat-icon" style={{ color: 'var(--color-danger)' }} />
                            <div className="stat-label">Total Pendente</div>
                        </div>
                        <div className="stat-value" style={{ color: 'var(--color-danger)' }}>
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.pending)}
                        </div>
                    </div>

                    <div className={`card ${stats.balance >= 0 ? 'border-success' : 'border-danger'}`} style={{ 
                        borderLeft: `4px solid ${stats.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)'}`,
                        background: stats.balance >= 0 ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)'
                    }}>
                        <div className="stat-header">
                            <CheckCircle2 size={18} className="stat-icon" style={{ color: stats.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }} />
                            <div className="stat-label">Saldo Após Pagamentos</div>
                        </div>
                        <div className="stat-value" style={{ color: stats.balance >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.balance)}
                        </div>
                    </div>
                </div>

                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th style={{ width: '50px', textAlign: 'center' }}>Pago</th>
                                <th>Vencimento</th>
                                <th>Fornecedor</th>
                                <th>Descrição/Doc</th>
                                <th className="th-right">Valor</th>
                                <th style={{ width: '50px' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {selectedList.items.map((item, idx) => (
                                <tr key={idx} style={{ opacity: item.paid ? 0.6 : 1, backgroundColor: item.paid ? 'var(--color-bg-base)' : undefined }}>
                                    <td style={{ textAlign: 'center' }}>
                                        <button 
                                            onClick={() => handleUpdateItemStatus(idx, !item.paid)}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: item.paid ? 'var(--color-success)' : 'var(--color-text-muted)' }}
                                        >
                                            {item.paid ? <CheckCircle2 size={24} /> : <Circle size={24} />}
                                        </button>
                                    </td>
                                    <td>
                                        <span style={{ textDecoration: item.paid ? 'line-through' : 'none' }}>{item.vencimento}</span>
                                    </td>
                                    <td style={{ fontWeight: 600 }}>{item.nome}</td>
                                    <td style={{ fontSize: '0.875rem' }}>
                                        {item.descricao} {item.documento && <code style={{ fontSize: '0.7rem', opacity: 0.7 }}>[{item.documento}]</code>}
                                    </td>
                                    <td className="value-cell" style={{ color: item.paid ? 'var(--color-text-muted)' : 'inherit' }}>
                                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor)}
                                    </td>
                                    <td>
                                        <button 
                                            onClick={() => handleRemoveItem(idx)}
                                            className="action-btn-small hover-danger"
                                            title="Remover da lista"
                                        >
                                            <XCircle size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{ fontWeight: 700 }}>
                                <td colSpan={4} style={{ textAlign: 'right', padding: '1rem' }}>Total Pago na Lista:</td>
                                <td className="value-cell" style={{ color: 'var(--color-success)' }}>
                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.paid)}
                                </td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                    
                    {selectedList.items.length === 0 && (
                        <div className="empty-state">
                            <p>Esta lista está vazia.</p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="payment-lists-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <ListChecks size={24} className="stat-icon" style={{ color: 'var(--color-accent)' }} />
                    Suas Listas de Pagamentos
                </h2>
            </div>

            {lists.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                    <div style={{ marginBottom: '1.5rem', opacity: 0.3 }}>
                        <FileText size={64} style={{ margin: '0 auto' }} />
                    </div>
                    <h3>Nenhuma lista salva ainda</h3>
                    <p className="text-muted">Selecione faturas no Dashboard e clique em "Salvar Lista" para começar o seu planejamento.</p>
                </div>
            ) : (
                <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                    {lists.map(list => {
                        const total = list.items.reduce((acc, curr) => acc + (curr.valor || 0), 0);
                        const paidItems = list.items.filter(i => i.paid).length;
                        return (
                            <div 
                                key={list.id} 
                                className="card list-card clickable" 
                                onClick={() => setSelectedList(list)}
                                style={{ 
                                    cursor: 'pointer', 
                                    transition: 'transform 0.2s',
                                    borderTop: '4px solid var(--color-accent)'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                    <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{list.name}</h3>
                                    <button 
                                        onClick={(e) => handleDeleteList(list.id, e)}
                                        className="action-btn-small hover-danger"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 700 }}>
                                        <span>Total:</span>
                                        <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                        <span>Itens: {list.items.length}</span>
                                        <span>Progresso: {paidItems}/{list.items.length} pagos</span>
                                    </div>
                                    <div className="progress-bar-bg" style={{ height: '6px', background: 'var(--color-bg-base)', borderRadius: '3px', marginTop: '0.5rem', overflow: 'hidden' }}>
                                        <div 
                                            className="progress-bar-fill" 
                                            style={{ 
                                                height: '100%', 
                                                width: `${(paidItems / list.items.length) * 100}%`,
                                                background: 'var(--color-success)',
                                                borderRadius: '3px',
                                                transition: 'width 0.3s ease'
                                            }}
                                        />
                                    </div>
                                </div>
                                <div style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--color-text-muted)', textAlign: 'right' }}>
                                    {new Date(list.created_at).toLocaleDateString('pt-BR')}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default PaymentLists;
