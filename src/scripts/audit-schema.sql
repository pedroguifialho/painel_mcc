-- 1. Criar tabela de Logs de Alterações
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL, -- 'INSERT', 'UPDATE', 'DELETE'
  table_name TEXT NOT NULL,
  record_id UUID,
  changes JSONB, -- Detalhes do que mudou
  details TEXT
);

-- 2. Habilitar RLS nos logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. Política de visualização de logs (Apenas usuários autenticados)
CREATE POLICY "Allow authenticated to view logs" ON audit_logs
  FOR SELECT TO authenticated
  USING (true);

-- 4. Função para registrar auditoria automaticamente
CREATE OR REPLACE FUNCTION audit_action()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (user_email, action, table_name, record_id, changes)
  VALUES (
    auth.jwt() ->> 'email',
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE 
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
      WHEN TG_OP = 'INSERT' THEN to_jsonb(NEW)
      ELSE to_jsonb(OLD)
    END
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Vincular a função à tabela de pagamentos
DROP TRIGGER IF EXISTS tr_audit_payments ON payments;
CREATE TRIGGER tr_audit_payments
AFTER INSERT OR UPDATE OR DELETE ON payments
FOR EACH ROW EXECUTE FUNCTION audit_action();
