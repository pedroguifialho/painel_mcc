import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Lock, Mail, Loader2, AlertCircle } from 'lucide-react';

const Login = ({ onLogin }) => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleLogin = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password
        });

        if (error) {
            setError('E-mail ou senha inválidos. Verifique suas credenciais.');
            setLoading(false);
        } else {
            onLogin(data.user);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <div className="login-header">
                    <div className="login-logo">
                        <Lock size={32} />
                    </div>
                    <h2>Acesso Restrito</h2>
                    <p>Painel Financeiro MCC</p>
                </div>

                <form onSubmit={handleLogin}>
                    <div className="input-field">
                        <label>E-mail</label>
                        <div className="input-wrapper">
                            <Mail size={18} />
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="seu@email.com"
                                required
                            />
                        </div>
                    </div>

                    <div className="input-field">
                        <label>Senha</label>
                        <div className="input-wrapper">
                            <Lock size={18} />
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••"
                                required
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="login-error">
                            <AlertCircle size={16} />
                            <span>{error}</span>
                        </div>
                    )}

                    <button type="submit" disabled={loading} className="login-btn">
                        {loading ? (
                            <>
                                <Loader2 size={18} className="animate-spin" />
                                Entrando...
                            </>
                        ) : 'Entrar no Sistema'}
                    </button>
                </form>

                <div className="login-footer">
                    <p>© 2026 Marcenaria MCC - Uso Interno</p>
                </div>
            </div>

            <style>{`
                .login-container {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                    background: var(--color-bg-base);
                    padding: 1rem;
                }
                .login-card {
                    width: 100%;
                    max-width: 400px;
                    background: var(--color-bg-elevated);
                    border: 1px solid var(--color-border);
                    border-radius: 16px;
                    padding: 2.5rem;
                    box-shadow: var(--shadow-xl);
                }
                .login-header {
                    text-align: center;
                    margin-bottom: 2rem;
                }
                .login-logo {
                    display: inline-flex;
                    padding: 1rem;
                    background: var(--color-accent-subtle);
                    color: var(--color-accent);
                    border-radius: 50%;
                    margin-bottom: 1rem;
                }
                .login-header h2 {
                    font-size: 1.5rem;
                    margin-bottom: 0.25rem;
                }
                .login-header p {
                    color: var(--color-text-muted);
                }
                .input-field {
                    margin-bottom: 1.5rem;
                }
                .input-field label {
                    display: block;
                    font-size: 0.875rem;
                    font-weight: 600;
                    margin-bottom: 0.5rem;
                }
                .input-wrapper {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    background: var(--color-bg-base);
                    border: 1px solid var(--color-border);
                    border-radius: 8px;
                    padding: 0 1rem;
                    transition: all 0.2s;
                }
                .input-wrapper:focus-within {
                    border-color: var(--color-accent);
                    box-shadow: 0 0 0 2px var(--color-accent-subtle);
                }
                .input-wrapper input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    height: 44px;
                    color: var(--color-text-base);
                    outline: none;
                }
                .login-btn {
                    width: 100%;
                    height: 48px;
                    background: var(--color-accent);
                    color: white;
                    border: none;
                    border-radius: 8px;
                    font-weight: 700;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    transition: filter 0.2s;
                }
                .login-btn:hover {
                    filter: brightness(1.1);
                }
                .login-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                .login-error {
                    background: var(--color-danger-subtle);
                    color: var(--color-danger);
                    padding: 0.75rem;
                    border-radius: 8px;
                    margin-bottom: 1.5rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-size: 0.875rem;
                }
                .login-footer {
                    margin-top: 2rem;
                    text-align: center;
                    font-size: 0.75rem;
                    color: var(--color-text-muted);
                }
                .animate-spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};

export default Login;
