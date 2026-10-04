# Bansir Terminal — piloto UltraGas

O PDV registra a entrega com `isPaid: false` e `paymentStatus: pagar_na_entrega`. A API mantém o lançamento financeiro pendente até o Terminal completar a cobrança.

## Render

Configure no serviço `bansir-demo-ultragas-backend`:

```env
TERMINAL_API_TOKEN=<segredo-aleatorio-com-pelo-menos-32-caracteres>
```

O servidor continua iniciando sem essa variável, mas as rotas `/api/v1/terminal/*` respondem `503` até a integração ser configurada.

## Ativação local do APK

1. Inicie `mock-activation-server`.
2. No painel de aprovação, mantenha a API `https://bansir-demo-ultragas-backend.onrender.com/api/v1`.
3. Cole em **Token da API** exatamente o valor configurado em `TERMINAL_API_TOKEN` no Render.
4. Ative o Terminal e entre com o operador de teste (`admin` / `1234`).

O token fica no armazenamento criptografado do Android e não é gravado no repositório.

## Fluxo

- `GET /api/v1/terminal/orders`: pedidos de entrega com saldo.
- `POST /api/v1/terminal/orders/:orderNumber/payments`: registra cada parte aprovada da cobrança.
- `POST /api/v1/terminal/orders/:orderNumber/adjustments`: reduz o valor a receber, exigindo motivo e auditoria.
- `GET /api/v1/terminal/products`: catálogo ativo para a próxima etapa de sincronização.

Cada pagamento possui `paymentId` e `idempotencyKey`. Uma repetição causada por queda de internet retorna o mesmo resultado e não duplica o valor.
