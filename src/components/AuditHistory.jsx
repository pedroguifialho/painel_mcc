import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { History, User, Clock, Info, ChevronDown, ChevronUp } from 'lucide-react';

const AuditHistory = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [expandedLog, setExpandedLog] = useState(null);

    useEffect(() => {
        fetchLogs();
        
        const channel = supabase
            .channel('audit_logs_realtime')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, () => {
                fetchLogs();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, []);

    const fetchLogs = async () => {
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50);

        if (!error) setLogs(data);
        setLoading(false);
    };

    const formatDate = (iso) => {
        return new Date(iso).toLocaleString('pt-BR');
    };

    const getActionLabel = (action) => {
        const map = {
            'INSERT': { label: 'Inclusão', color: 'var(--color-success)' },
            'UPDATE': { label: 'Alteração', color: 'var(--color-warning)' },
            'DELETE': { label: 'Exclusão', color: 'var(--color-danger)' }
        };
        return map[action] || { label: action, color: 'var(--color-text-muted)' };
    };

    return (
        <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <History size={24} className="stat-icon" />
                <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Histórico de Alterações</h2>
            </div>

            {loading ? (
                <div style={{ padding: '2rem', textAlign: 'center' }}>Carregando histórico...</div>
            ) : logs.length === 0 ? (
                <div className="empty-state">Nenhuma alteração registrada ainda.</div>
            ) : (
                <div className="audit-list">
                    {logs.map((log) => (
                        <div key={log.id} className="audit-item">
                            <div className="audit-main" onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}>
                                <div className="audit-info">
                                    <div className="audit-user">
                                        <User size={14} />
                                        <span>{log.user_email || 'Sistema/Importação'}</span>
                                    </div>
                                    <div className="audit-time">
                                        <Clock size={14} />
                                        <span>{formatDate(log.created_at)}</span>
                                    </div>
                                </div>
                                
                                <div className="audit-action">
                                    <span style={{ 
                                        padding: '0.2rem 0.5rem', 
                                        borderRadius: '4px', 
                                        fontSize: '0.75rem', 
                                        fontWeight: 700,
                                        background: getActionLabel(log.action).color + '22',
                                        color: getActionLabel(log.action).color
                                    }}>
                                        {getActionLabel(log.action).label}
                                    </span>
                                    <span style={{ fontSize: '0.85rem' }}>em {log.table_name}</span>
                                    {expandedLog === log.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </div>
                            </div>

                            {expandedLog === log.id && (
                                <div className="audit-details">
                                    <pre style={{ fontSize: '0.75rem', overflow: 'auto' }}>
                                        {JSON.stringify(log.changes, null, 2)}
                                    </pre>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            <style>{`
                .audit-list {
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                }
                .audit-item {
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    overflow: hidden;
                    background: var(--color-bg-base);
                }
                .audit-main {
                    padding: 1rem;
                    cursor: pointer;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    transition: background 0.2s;
                }
                .audit-main:hover {
                    background: var(--color-bg-elevated);
                }
                .audit-info {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                }
                .audit-user, .audit-time {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.75rem;
                    color: var(--color-text-muted);
                }
                .audit-user span {
                    font-weight: 600;
                    color: var(--color-text-base);
                }
                .audit-action {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                }
                .audit-details {
                    padding: 1rem;
                    background: rgba(0,0,0,0.1);
                    border-top: 1px solid var(--color-border);
                }
            `}</style>
        </div>
    );
};

export default AuditHistory;
