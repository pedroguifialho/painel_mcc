import React, { useState, useRef } from 'react';
import { UploadCloud, Loader2 } from 'lucide-react';
import { extractTableFromImage } from '../lib/gemini';

const ImageUploader = ({ onExtractedData }) => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef(null);

    const handleFileProcess = async (file) => {
        if (!file || !file.type.startsWith('image/')) {
            setError('Por favor, selecione um arquivo de formato imagem válido (PNG, JPG, etc).');
            return;
        }

        setError('');
        setIsLoading(true);

        try {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const base64String = reader.result.split(',')[1];
                const mimeType = file.type;

                try {
                    const data = await extractTableFromImage(base64String, mimeType);
                    onExtractedData(data);
                } catch (apiErr) {
                    setError(apiErr.message);
                } finally {
                    setIsLoading(false);
                }
            };
            reader.onerror = () => {
                setError('Erro ao ler seu arquivo de imagem local.');
                setIsLoading(false);
            };
        } catch (err) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    return (
        <div 
            style={{ 
                border: '2px dashed var(--color-border)', 
                borderRadius: '12px', 
                padding: '3rem', 
                textAlign: 'center', 
                backgroundColor: 'var(--color-bg-elevated)', 
                cursor: isLoading ? 'wait' : 'pointer',
                transition: 'all 0.2s',
                marginBottom: '2rem'
            }}
            onClick={() => !isLoading && fileInputRef.current?.click()}
        >
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept="image/*" 
                onChange={(e) => handleFileProcess(e.target.files[0])} 
            />
            
            {isLoading ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <Loader2 size={48} className="stat-icon" style={{ animation: 'spin 2s linear infinite' }} />
                    <h3 style={{ color: 'var(--color-accent)' }}>A Nuvem de IA está Lendo a Imagem...</h3>
                    <p className="text-muted">Isso pode levar alguns segundos dependendo do tamanho da tabela.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <UploadCloud size={48} style={{ color: 'var(--color-text-muted)' }} />
                    <h3 style={{ color: 'var(--color-accent)' }}>Clique para Importar o Print da Tabela</h3>
                    <p className="text-muted">A Inteligência Artificial Gemini (Visão) converterá os dados para você.</p>
                </div>
            )}
            
            {error && (
                <div style={{ marginTop: '1rem', padding: '1rem', background: '#fee2e2', color: '#b91c1c', borderRadius: '8px', fontSize: '0.9rem' }}>
                    <strong>Erro de Visão:</strong> {error}
                </div>
            )}
        </div>
    );
};

export default ImageUploader;
