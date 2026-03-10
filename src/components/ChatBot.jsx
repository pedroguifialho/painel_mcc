import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Settings, Key, Trash2, Bot, User } from 'lucide-react';

const SYSTEM_PROMPT = `Você é um assistente financeiro especializado em análise de contas a pagar. Seu nome é "Assistente MCC".
Você responde APENAS perguntas relacionadas aos dados financeiros fornecidos. Se perguntarem algo fora do escopo dos dados, diga educadamente que só pode ajudar com questões sobre os dados financeiros.
Responda sempre em Português do Brasil, de forma clara e concisa.
Use formatação simples. Quando mencionar valores monetários, use o formato R$ X.XXX,XX.
Quando fizer cálculos, mostre o resultado de forma organizada.`;

function buildDataSummary(data) {
    if (!data || data.length === 0) return 'Nenhum dado disponivel.';

    const total = data.reduce((acc, d) => acc + (d.valor || 0), 0);
    const count = data.length;

    const supplierTotals = {};
    const supplierCounts = {};
    const monthlyTotals = {};
    const today = new Date().toISOString().split('T')[0];
    let overdueCount = 0;
    let overdueTotal = 0;
    const overdueRecords = [];

    data.forEach(d => {
        const name = d.nome || 'Desconhecido';
        supplierTotals[name] = (supplierTotals[name] || 0) + (d.valor || 0);
        supplierCounts[name] = (supplierCounts[name] || 0) + 1;

        if (d.vencimento) {
            const parts = d.vencimento.split('/');
            if (parts.length === 3) {
                const monthKey = parts[1] + '/' + parts[2];
                monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + (d.valor || 0);

                const isoDate = parts[2] + '-' + parts[1] + '-' + parts[0];
                if (isoDate < today) {
                    overdueCount++;
                    overdueTotal += (d.valor || 0);
                    if (overdueRecords.length < 15) overdueRecords.push(d);
                }
            }
        }
    });

    const fmtBRL = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    const allSuppliers = Object.entries(supplierTotals)
        .sort((a, b) => b[1] - a[1])
        .map(([name, val]) => '  - ' + name + ': R$ ' + fmtBRL(val) + ' (' + supplierCounts[name] + ' reg.)')
        .join('\n');

    const monthlyBreakdown = Object.entries(monthlyTotals)
        .sort((a, b) => {
            const [mA, yA] = a[0].split('/');
            const [mB, yB] = b[0].split('/');
            return (yA + '-' + mA).localeCompare(yB + '-' + mB);
        })
        .map(([month, val]) => '  - ' + month + ': R$ ' + fmtBRL(val))
        .join('\n');

    const topOverdue = overdueRecords
        .sort((a, b) => b.valor - a.valor)
        .slice(0, 10)
        .map(d => '  - Venc: ' + d.vencimento + ' | ' + d.nome + ' | R$ ' + fmtBRL(d.valor || 0))
        .join('\n');

    const totalSuppliers = Object.keys(supplierTotals).length;
    const avgVal = count > 0 ? total / count : 0;

    return 'RESUMO DOS DADOS FINANCEIROS (Contas a Pagar):\n' +
        '- Total de registros: ' + count + '\n' +
        '- Valor total: R$ ' + fmtBRL(total) + '\n' +
        '- Valor medio: R$ ' + fmtBRL(avgVal) + '\n' +
        '- Fornecedores distintos: ' + totalSuppliers + '\n' +
        '- Contas vencidas: ' + overdueCount + ' registros = R$ ' + fmtBRL(overdueTotal) + '\n\n' +
        'TODOS OS FORNECEDORES:\n' + allSuppliers + '\n\n' +
        'TOTAIS POR MES:\n' + monthlyBreakdown + '\n\n' +
        'MAIORES CONTAS ATRASADAS:\n' + (topOverdue || '  Nenhuma.') + '\n\n' +
        'Use SOMENTE os dados acima. Nao invente valores.';
}

async function callGemini(apiKey, messages, dataSummary) {
    const contextMessage = {
        role: 'user',
        parts: [{ text: SYSTEM_PROMPT + '\n\nAqui estao os dados para analise:\n' + dataSummary }]
    };

    const modelResponse = {
        role: 'model',
        parts: [{ text: 'Entendido! Sou o Assistente MCC. Estou pronto para responder suas perguntas sobre os dados financeiros. Pode perguntar!' }]
    };

    const formattedHistory = [contextMessage, modelResponse];

    messages.forEach(msg => {
        formattedHistory.push({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.content }]
        });
    });

    const lastMessage = formattedHistory.pop();

    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [...formattedHistory, lastMessage],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 2048,
                }
            })
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || 'Erro da API: ' + response.status);
    }

    const result = await response.json();
    return result?.candidates?.[0]?.content?.parts?.[0]?.text || 'Sem resposta.';
}

const ChatBot = ({ data }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
    const [showSettings, setShowSettings] = useState(false);
    const [keyInput, setKeyInput] = useState('');
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const dataSummary = useCallback(() => buildDataSummary(data), [data]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            setTimeout(() => inputRef.current?.focus(), 300);
        }
    }, [isOpen]);

    const handleSaveKey = () => {
        const trimmed = keyInput.trim();
        if (trimmed) {
            localStorage.setItem('gemini_api_key', trimmed);
            setApiKey(trimmed);
            setShowSettings(false);
            setKeyInput('');
        }
    };

    const handleSend = async () => {
        const trimmed = input.trim();
        if (!trimmed || isLoading) return;

        if (!apiKey) {
            setShowSettings(true);
            return;
        }

        const userMessage = { role: 'user', content: trimmed };
        const newMessages = [...messages, userMessage];
        setMessages(newMessages);
        setInput('');
        setIsLoading(true);

        try {
            const reply = await callGemini(apiKey, newMessages, dataSummary());
            setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: '❌ Erro: ' + err.message + '\n\nVerifique sua API Key nas configuracoes.'
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const clearHistory = () => {
        setMessages([]);
    };

    const needsKey = !apiKey;

    return (
        <>
            {/* Floating Button */}
            <button
                className="chatbot-fab"
                onClick={() => setIsOpen(!isOpen)}
                title="Assistente de Dados"
            >
                {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
            </button>

            {/* Chat Panel */}
            {isOpen && (
                <div className="chatbot-panel">
                    {/* Header */}
                    <div className="chatbot-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <Bot size={20} />
                            <span style={{ fontWeight: 700 }}>Assistente MCC</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                            <button
                                className="chatbot-header-btn"
                                onClick={clearHistory}
                                title="Limpar conversa"
                            >
                                <Trash2 size={16} />
                            </button>
                            <button
                                className="chatbot-header-btn"
                                onClick={() => { setShowSettings(!showSettings); setKeyInput(''); }}
                                title="Configuracoes"
                            >
                                <Settings size={16} />
                            </button>
                            <button
                                className="chatbot-header-btn"
                                onClick={() => setIsOpen(false)}
                                title="Fechar"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Settings Panel */}
                    {showSettings && (
                        <div className="chatbot-settings">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                <Key size={16} />
                                <strong>API Key do Gemini</strong>
                            </div>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                                Cole sua chave do <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>Google AI Studio</a>. Ela fica salva apenas no seu navegador.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <input
                                    type="password"
                                    value={keyInput}
                                    onChange={(e) => setKeyInput(e.target.value)}
                                    placeholder={apiKey ? '••••••••' : 'AIza...'}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSaveKey()}
                                    style={{ flex: 1 }}
                                />
                                <button className="action-btn" onClick={handleSaveKey} style={{ padding: '0.5rem 1rem' }}>
                                    Salvar
                                </button>
                            </div>
                            {apiKey && (
                                <p style={{ fontSize: '0.75rem', color: 'var(--color-success)', marginTop: '0.5rem' }}>
                                    ✅ Chave configurada
                                </p>
                            )}
                        </div>
                    )}

                    {/* Messages */}
                    <div className="chatbot-messages">
                        {messages.length === 0 && !needsKey && (
                            <div className="chatbot-welcome">
                                <Bot size={40} style={{ color: 'var(--color-accent)', marginBottom: '0.75rem' }} />
                                <h4>Ola! Sou o Assistente MCC</h4>
                                <p>Posso responder perguntas sobre seus dados financeiros. Experimente:</p>
                                <div className="chatbot-suggestions">
                                    {[
                                        'Qual o total a pagar?',
                                        'Quem e o maior fornecedor?',
                                        'Quantas contas estao atrasadas?',
                                        'Resumo por mes'
                                    ].map((q, i) => (
                                        <button
                                            key={i}
                                            className="chatbot-suggestion"
                                            onClick={() => { setInput(q); }}
                                        >
                                            {q}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {needsKey && messages.length === 0 && (
                            <div className="chatbot-welcome">
                                <Key size={40} style={{ color: 'var(--color-warning)', marginBottom: '0.75rem' }} />
                                <h4>Configure sua API Key</h4>
                                <p>Para funcionar, preciso de uma chave da API do Google Gemini.</p>
                                <button
                                    className="action-btn"
                                    onClick={() => setShowSettings(true)}
                                    style={{ marginTop: '0.75rem' }}
                                >
                                    <Settings size={16} /> Configurar Agora
                                </button>
                            </div>
                        )}

                        {messages.map((msg, i) => (
                            <div key={i} className={'chatbot-msg ' + msg.role}>
                                <div className="chatbot-msg-icon">
                                    {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
                                </div>
                                <div className="chatbot-msg-bubble">
                                    {msg.content.split('\n').map((line, j) => (
                                        <React.Fragment key={j}>
                                            {line}
                                            {j < msg.content.split('\n').length - 1 && <br />}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {isLoading && (
                            <div className="chatbot-msg assistant">
                                <div className="chatbot-msg-icon">
                                    <Bot size={16} />
                                </div>
                                <div className="chatbot-msg-bubble chatbot-typing">
                                    <span></span><span></span><span></span>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="chatbot-input-area">
                        <input
                            ref={inputRef}
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Pergunte sobre os dados..."
                            disabled={isLoading}
                        />
                        <button
                            className="chatbot-send-btn"
                            onClick={handleSend}
                            disabled={isLoading || !input.trim()}
                            title="Enviar"
                        >
                            <Send size={18} />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};

export default ChatBot;
