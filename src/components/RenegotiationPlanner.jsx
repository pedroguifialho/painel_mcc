import React, { useState, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
    Handshake, Loader2, AlertTriangle, CheckCircle2, FileText,
    ClipboardList, DollarSign, BarChart2, Download, Settings2,
    RefreshCw, ChevronDown, ChevronUp, Info
} from 'lucide-react';

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt = (v) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);
const today = () => new Date().toISOString().split('T')[0];

const GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=';

// ─── prompt builder ──────────────────────────────────────────────────────────
function buildPrompt({ regra, restricoes, debitos }) {
    const todayStr = new Date().toLocaleDateString('pt-BR');

    const rows = debitos
        .map((d, i) =>
            `${i + 1}. Venc: ${d.vencimento} | Fornecedor: ${d.nome} | Valor: ${fmt(d.valor)} | Desc: ${d.descricao || '-'} | Obs: ${d.observacao || '-'}`
        )
        .join('\n');

    const totalDebitos = debitos.reduce((s, d) => s + (d.valor || 0), 0);
    const qtdAtrasados = debitos.filter(d => d.data_iso < today()).length;
    const qtdAVencer = debitos.length - qtdAtrasados;

    return `Você é um especialista em renegociação de dívidas empresariais.
Data de referência: ${todayStr}
Total de débitos analisados: ${debitos.length} (${qtdAtrasados} atrasados, ${qtdAVencer} a vencer)
Valor total: ${fmt(totalDebitos)}

REGRA DE RENEGOCIAÇÃO INFORMADA PELO USUÁRIO:
"${regra}"

RESTRIÇÕES E PARÂMETROS:
- Número máximo de parcelas: ${restricoes.maxParcelas}
- Entrada mínima: ${restricoes.entradaMinPct}% do total
- Desconto máximo permitido em multas/juros: ${restricoes.descontoMaxPct}%
- Prazo máximo para quitação: ${restricoes.prazoMaxMeses} meses

LISTA DE DÉBITOS:
${rows}

---

Gere um relatório COMPLETO de renegociação, estruturado EXATAMENTE nos 3 blocos abaixo com os marcadores exatos (texto entre ===):

=== PLANO DE ACAO ===
(Descreva os passos concretos para a negociação, abordagem recomendada, argumentos para uso com fornecedores/credores, priorização de quais dívidas atacar primeiro. Use linguagem direta e operacional.)

=== PROPOSTA DE PARCELAS ===
(Gere a tabela de parcelamento no formato a seguir — uma linha por parcela:)
PARCELA | VENCIMENTO | VALOR | DESCRICAO
1 | DD/MM/AAAA | R$ X.XXX,XX | [detalhe]
2 | DD/MM/AAAA | R$ X.XXX,XX | [detalhe]
...
(Calcule a entrada se aplicável e distribua o saldo nas parcelas seguintes. Garanta que a soma bata com o total negociado após os descontos aplicados.)

=== RELATORIO CONSOLIDADO ===
(Inclua: resumo das regras aplicadas, justificativa da estratégia, riscos identificados, capacidade de pagamento estimada, e recomendações finais para o time de cobrança/negociação.)

Responda SOMENTE com o conteúdo dos 3 blocos. Nenhuma introdução ou nota fora dos blocos.`;
}

// ─── call Gemini ─────────────────────────────────────────────────────────────
async function callGemini(apiKey, prompt) {
    const res = await fetch(GEMINI_URL + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 4096 }
        })
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.message || `Erro ${res.status} na API Gemini`);
    }
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── parse response into 3 sections ─────────────────────────────────────────
function parseResponse(text) {
    const extract = (tag) => {
        const re = new RegExp(`===\\s*${tag}\\s*===([\\s\\S]*?)(?:===|$)`, 'i');
        const m = text.match(re);
        return m ? m[1].trim() : '';
    };

    const parcelas = [];
    const proposSection = extract('PROPOSTA DE PARCELAS');
    proposSection.split('\n').forEach(line => {
        // e.g.  1 | 10/04/2026 | R$ 1.200,00 | Entrada
        const parts = line.split('|').map(s => s.trim());
        if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
            parcelas.push({
                numero: parts[0],
                vencimento: parts[1] || '-',
                valor: parts[2] || '-',
                descricao: parts[3] || '-'
            });
        }
    });

    return {
        planoAcao: extract('PLANO DE ACAO'),
        proposta: proposSection,
        parcelas,
        relatorio: extract('RELATORIO CONSOLIDADO')
    };
}

// ─── export PDF ──────────────────────────────────────────────────────────────
function exportPDF(result, restricoes, totalDebitos, qtdDebitos) {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true });
    const dateNow = new Date().toLocaleDateString('pt-BR');
    let y = 22;

    doc.setFontSize(18);
    doc.setTextColor(234, 88, 12);
    doc.text('Plano de Renegociacao - MCC', 14, y); y += 8;
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Gerado em: ${dateNow}  |  Debitos analisados: ${qtdDebitos}  |  Total: ${fmt(totalDebitos)}`, 14, y); y += 10;

    const writeSection = (title, content, color = [30, 64, 175]) => {
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFontSize(12);
        doc.setTextColor(...color);
        doc.setFont('helvetica', 'bold');
        doc.text(title, 14, y); y += 6;
        doc.setFontSize(9);
        doc.setTextColor(40);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(content, 180);
        lines.forEach(line => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.text(line, 14, y);
            y += 5;
        });
        y += 6;
    };

    writeSection('1. Plano de Acao', result.planoAcao, [234, 88, 12]);

    // Parcelas table
    if (result.parcelas.length > 0) {
        if (y > 230) { doc.addPage(); y = 20; }
        doc.setFontSize(12);
        doc.setTextColor(30, 64, 175);
        doc.setFont('helvetica', 'bold');
        doc.text('2. Proposta de Parcelas', 14, y); y += 4;
        autoTable(doc, {
            head: [['#', 'Vencimento', 'Valor', 'Descricao']],
            body: result.parcelas.map(p => [p.numero, p.vencimento, p.valor, p.descricao]),
            startY: y,
            theme: 'grid',
            headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 9 },
            styles: { fontSize: 8, cellPadding: 2.5 },
            columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 30, halign: 'center' }, 2: { cellWidth: 35, halign: 'right' } },
            margin: { left: 14, right: 14 }
        });
        y = doc.lastAutoTable.finalY + 8;
    }

    writeSection('3. Relatorio Consolidado', result.relatorio, [14, 116, 144]);

    doc.save(`renegociacao_mcc_${dateNow.replace(/\//g, '-')}.pdf`);
}

// ─── Section collapse helper ─────────────────────────────────────────────────
function Section({ title, icon: Icon, color, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);
    return (
        <div style={{ border: `1px solid var(--color-border)`, borderRadius: '12px', overflow: 'hidden', background: 'var(--color-bg-surface)' }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: 'var(--color-bg-elevated)', border: 'none', cursor: 'pointer', color: 'var(--color-text-base)' }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontWeight: 700, fontSize: '1rem' }}>
                    <Icon size={18} color={color} /> {title}
                </span>
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>
            {open && <div style={{ padding: '1.25rem' }}>{children}</div>}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────
const RenegotiationPlanner = ({ data, allData }) => {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';

    // Form state
    const [regra, setRegra] = useState('');
    const [escopo, setEscopo] = useState('atrasados'); // 'atrasados' | 'avencer' | 'todos'
    const [maxParcelas, setMaxParcelas] = useState(12);
    const [entradaMinPct, setEntradaMinPct] = useState(20);
    const [descontoMaxPct, setDescontoMaxPct] = useState(30);
    const [prazoMaxMeses, setPrazoMaxMeses] = useState(12);
    const [showConfig, setShowConfig] = useState(false);

    // Result state
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    const todayIso = today();

    // Derive debitos based on escopo
    const debitos = useMemo(() => {
        const base = data && data.length > 0 ? data : (allData || []);
        if (escopo === 'atrasados') return base.filter(d => d.data_iso && d.data_iso < todayIso);
        if (escopo === 'avencer') return base.filter(d => d.data_iso && d.data_iso >= todayIso);
        return base;
    }, [data, allData, escopo, todayIso]);

    const totalDebitos = debitos.reduce((s, d) => s + (d.valor || 0), 0);
    const qtdAtrasados = debitos.filter(d => d.data_iso < todayIso).length;

    const handleGenerate = async () => {
        if (!regra.trim()) { setError('Descreva a regra de renegociação antes de gerar o plano.'); return; }
        if (debitos.length === 0) { setError('Nenhum débito encontrado no escopo selecionado. Ajuste os filtros globais ou mude o escopo.'); return; }
        if (!apiKey) { setError('API Key do Gemini não configurada. Adicione VITE_GEMINI_API_KEY no .env.local ou configure no ChatBot.'); return; }

        setError(null);
        setResult(null);
        setIsLoading(true);

        try {
            const prompt = buildPrompt({
                regra: regra.trim(),
                restricoes: { maxParcelas, entradaMinPct, descontoMaxPct, prazoMaxMeses },
                debitos
            });
            const raw = await callGemini(apiKey, prompt);
            setResult(parseResponse(raw));
        } catch (err) {
            setError('Erro ao chamar a IA: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const formatTextBlock = (text) =>
        (text || '').split('\n').map((line, i) => (
            <React.Fragment key={i}>
                {line.startsWith('-') || line.startsWith('•')
                    ? <span style={{ display: 'block', paddingLeft: '1rem', marginBottom: '0.25rem' }}>{line}</span>
                    : line.match(/^\d+\./)
                        ? <span style={{ display: 'block', fontWeight: 600, marginTop: '0.5rem', marginBottom: '0.2rem' }}>{line}</span>
                        : <span style={{ display: 'block', marginBottom: '0.2rem' }}>{line}</span>
                }
            </React.Fragment>
        ));

    return (
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* Header */}
            <div className="card" style={{ background: 'linear-gradient(135deg, var(--color-bg-elevated), var(--color-accent-subtle))', border: '1px solid var(--color-accent)', padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ padding: '0.75rem', background: 'var(--color-accent)', borderRadius: '12px', color: 'white' }}>
                            <Handshake size={24} />
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--color-text-base)' }}>Renegociação com IA</h2>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                Descreva a política e gere um plano de ação estruturado automaticamente
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                        <div style={{ background: 'var(--color-bg-base)', borderRadius: '8px', padding: '0.5rem 1rem', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Débitos no escopo</div>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{debitos.length}</div>
                        </div>
                        <div style={{ background: 'var(--color-bg-base)', borderRadius: '8px', padding: '0.5rem 1rem', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total</div>
                            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-accent)' }}>{fmt(totalDebitos)}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Config Form */}
            <div className="card">
                {/* Scope selector */}
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                    {[
                        { key: 'atrasados', label: '⚠️ Apenas Atrasados', desc: `${data?.filter(d => d.data_iso < todayIso).length || 0} reg.` },
                        { key: 'avencer', label: '📅 Apenas a Vencer', desc: `${data?.filter(d => d.data_iso >= todayIso).length || 0} reg.` },
                        { key: 'todos', label: '📋 Todos os Filtrados', desc: `${data?.length || 0} reg.` },
                    ].map(opt => (
                        <button
                            key={opt.key}
                            onClick={() => setEscopo(opt.key)}
                            style={{
                                flex: 1, minWidth: '140px',
                                padding: '0.75rem', borderRadius: '8px', cursor: 'pointer',
                                border: `2px solid ${escopo === opt.key ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                background: escopo === opt.key ? 'var(--color-accent-subtle)' : 'var(--color-bg-elevated)',
                                color: 'var(--color-text-base)', fontWeight: escopo === opt.key ? 700 : 400,
                                transition: 'all 0.2s'
                            }}
                        >
                            <div style={{ fontSize: '0.9rem' }}>{opt.label}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.2rem' }}>{opt.desc}</div>
                        </button>
                    ))}
                </div>

                {/* Rule input */}
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                        📝 Regra / Política de Renegociação
                    </label>
                    <textarea
                        value={regra}
                        onChange={e => setRegra(e.target.value)}
                        rows={4}
                        placeholder="Ex: Priorizar fornecedores com valores acima de R$ 5.000. Oferecer redução de 20% nas multas para pagamento em até 5 dias. Para os demais, propor parcelamento em 6x com entrada de 30%."
                        style={{
                            width: '100%', boxSizing: 'border-box', padding: '0.85rem',
                            borderRadius: '8px', border: '1px solid var(--color-border)',
                            background: 'var(--color-bg-base)', color: 'var(--color-text-base)',
                            fontSize: '0.9rem', resize: 'vertical', lineHeight: 1.5,
                            fontFamily: 'inherit'
                        }}
                    />
                </div>

                {/* Advanced config toggle */}
                <button
                    onClick={() => setShowConfig(c => !c)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, marginBottom: showConfig ? '1rem' : 0 }}
                >
                    <Settings2 size={15} /> {showConfig ? 'Ocultar Parâmetros' : 'Parâmetros Avançados'}
                    {showConfig ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showConfig && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', padding: '1rem', background: 'var(--color-bg-elevated)', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
                        {[
                            { label: 'Máx. Parcelas', val: maxParcelas, set: setMaxParcelas, min: 1, max: 60, unit: 'x' },
                            { label: 'Entrada Mínima', val: entradaMinPct, set: setEntradaMinPct, min: 0, max: 100, unit: '%' },
                            { label: 'Desconto Máx. Multas', val: descontoMaxPct, set: setDescontoMaxPct, min: 0, max: 100, unit: '%' },
                            { label: 'Prazo Máx. Quitação', val: prazoMaxMeses, set: setPrazoMaxMeses, min: 1, max: 120, unit: 'meses' },
                        ].map(p => (
                            <div key={p.label}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: '0.35rem' }}>{p.label}</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <input
                                        type="number" min={p.min} max={p.max}
                                        value={p.val}
                                        onChange={e => p.set(Number(e.target.value))}
                                        style={{ width: '70px', padding: '0.4rem 0.5rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-base)', fontSize: '0.9rem' }}
                                    />
                                    <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{p.unit}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Action */}
                <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.75rem 1.75rem', borderRadius: '8px',
                            background: isLoading ? 'var(--color-bg-elevated)' : 'var(--color-accent)',
                            color: isLoading ? 'var(--color-text-muted)' : 'white',
                            border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer',
                            fontWeight: 700, fontSize: '1rem', transition: 'all 0.2s'
                        }}
                    >
                        {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Handshake size={18} />}
                        {isLoading ? 'Gerando plano…' : 'Gerar Plano de Renegociação'}
                    </button>

                    {result && (
                        <button
                            onClick={() => exportPDF(result, { maxParcelas, entradaMinPct, descontoMaxPct, prazoMaxMeses }, totalDebitos, debitos.length)}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', borderRadius: '8px', background: 'var(--color-bg-elevated)', color: 'var(--color-text-base)', border: '1px solid var(--color-border)', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
                        >
                            <Download size={16} /> Exportar PDF
                        </button>
                    )}

                    {result && (
                        <button
                            onClick={() => { setResult(null); setError(null); }}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', borderRadius: '8px', background: 'transparent', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', cursor: 'pointer', fontSize: '0.875rem' }}
                        >
                            <RefreshCw size={14} /> Novo Plano
                        </button>
                    )}
                </div>
            </div>

            {/* Error */}
            {error && (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', padding: '1rem 1.25rem', borderRadius: '10px', background: 'hsla(0,84%,60%,0.08)', border: '1px solid hsla(0,84%,60%,0.3)', color: '#f87171' }}>
                    <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                    <span style={{ fontSize: '0.9rem' }}>{error}</span>
                </div>
            )}

            {/* Loading skeleton */}
            {isLoading && (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center', padding: '3rem', textAlign: 'center' }}>
                    <Loader2 size={40} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                    <div>
                        <p style={{ fontWeight: 700, fontSize: '1.1rem', margin: 0 }}>Analisando {debitos.length} débitos…</p>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: '0.4rem' }}>
                            A IA está gerando o plano de ação, a proposta de parcelas e o relatório consolidado.
                        </p>
                    </div>
                </div>
            )}

            {/* Results */}
            {result && !isLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Success banner */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.85rem 1.25rem', borderRadius: '10px', background: 'hsla(142,71%,45%,0.08)', border: '1px solid hsla(142,71%,45%,0.3)', color: '#34d399' }}>
                        <CheckCircle2 size={18} />
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Plano gerado com sucesso a partir de {debitos.length} débitos ({fmt(totalDebitos)})</span>
                    </div>

                    {/* Section 1 – Action Plan */}
                    <Section title="1. Plano de Ação" icon={ClipboardList} color="#f97316">
                        <div style={{ fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--color-text-base)' }}>
                            {formatTextBlock(result.planoAcao)}
                        </div>
                    </Section>

                    {/* Section 2 – Installment Proposal */}
                    <Section title="2. Proposta de Parcelas" icon={DollarSign} color="#3b82f6">
                        {result.parcelas.length > 0 ? (
                            <>
                                <div className="table-container" style={{ margin: 0 }}>
                                    <table>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '50px', textAlign: 'center' }}>#</th>
                                                <th>Vencimento</th>
                                                <th className="th-right">Valor</th>
                                                <th>Descrição</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {result.parcelas.map((p, i) => (
                                                <tr key={i} style={{ background: i === 0 ? 'hsla(217,91%,60%,0.06)' : 'transparent' }}>
                                                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{p.numero}</td>
                                                    <td className="date-cell">{p.vencimento}</td>
                                                    <td className="value-cell">{p.valor}</td>
                                                    <td style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{p.descricao}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>
                                    <Info size={13} />
                                    <span>{result.parcelas.length} parcela(s) · Parâmetros: máx. {maxParcelas}x · entrada mín. {entradaMinPct}% · desconto máx. {descontoMaxPct}% · prazo {prazoMaxMeses} meses</span>
                                </div>
                            </>
                        ) : (
                            <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
                                {formatTextBlock(result.proposta)}
                            </div>
                        )}
                    </Section>

                    {/* Section 3 – Report */}
                    <Section title="3. Relatório Consolidado" icon={BarChart2} color="#10b981">
                        <div style={{ fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--color-text-base)' }}>
                            {formatTextBlock(result.relatorio)}
                        </div>
                    </Section>

                    {/* Export footer */}
                    <div style={{ textAlign: 'center', paddingTop: '0.5rem' }}>
                        <button
                            onClick={() => exportPDF(result, { maxParcelas, entradaMinPct, descontoMaxPct, prazoMaxMeses }, totalDebitos, debitos.length)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 2rem', borderRadius: '8px', background: 'var(--color-accent)', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.95rem' }}
                        >
                            <Download size={18} /> Exportar Relatório em PDF
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RenegotiationPlanner;
