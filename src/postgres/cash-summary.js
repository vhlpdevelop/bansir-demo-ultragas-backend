export async function cashProductTotals(c, cashId, cutoff) {
  const { rows } = await c.query(
    `SELECT i.product_id AS "productId",
            (array_agg(i.product_name ORDER BY s.created_at DESC, i.position ASC))[1] AS "productName",
            i.unit,
            sum(i.quantity)::bigint AS quantity,
            sum(i.gross_cents)::bigint AS "grossCents",
            sum(i.discount_cents)::bigint AS "discountCents",
            sum(i.gross_cents - i.discount_cents)::bigint AS "netCents",
            count(DISTINCT s.id)::int AS "salesCount"
     FROM bansir.sale_items i
     JOIN bansir.sales s ON (s.tenant_id, s.establishment_id, s.id) = (i.tenant_id, i.establishment_id, i.sale_id)
     WHERE s.cash_session_id = $1
       AND s.created_at <= $2
       AND NOT EXISTS (
         SELECT 1 FROM bansir.sale_cancellations x
         WHERE x.sale_id = s.id AND x.created_at <= $2
       )
     GROUP BY i.product_id, i.unit
     HAVING sum(i.quantity) > 0
     ORDER BY sum(i.quantity) DESC, min(i.product_name) ASC`,
    [cashId, cutoff]
  );
  return rows.map((row) => ({
    productId: row.productId,
    productName: row.productName,
    unit: row.unit || 'un',
    quantity: Number(row.quantity),
    grossCents: Number(row.grossCents),
    discountCents: Number(row.discountCents),
    netCents: Number(row.netCents),
    salesCount: Number(row.salesCount)
  }));
}

export async function cashFullSummary(c, { cash, cashViewData }) {
  const cutoff = cash.closed_at || new Date();
  const [establishmentRow, products, salesRows, movementsRows, previousPaymentsRows] = await Promise.all([
    c.query('SELECT name, document_id FROM bansir.establishments WHERE id = $1', [cash.establishment_id]),
    Array.isArray(cashViewData?.productSummary) ? Promise.resolve(cashViewData.productSummary) : cashProductTotals(c, cash.id, cutoff),
    c.query(
      `SELECT s.id, s.coupon_number, s.created_at, s.customer_name, s.delivery_mode,
              s.subtotal_cents, s.discount_cents, s.delivery_fee_cents, s.total_cents,
              x.created_at AS cancelled_at, x.reason AS cancellation_reason
       FROM bansir.sales s
       LEFT JOIN bansir.sale_cancellations x
         ON (x.tenant_id, x.establishment_id, x.sale_id) = (s.tenant_id, s.establishment_id, s.id)
        AND x.created_at <= $2
       WHERE s.cash_session_id = $1 AND s.created_at <= $2
       ORDER BY s.created_at ASC, s.coupon_number ASC`,
      [cash.id, cutoff]
    ),
    c.query(
      `SELECT id, kind, amount_cents, reason, created_at
       FROM bansir.cash_movements
       WHERE cash_session_id = $1 AND created_at <= $2
       ORDER BY created_at ASC, id ASC`,
      [cash.id, cutoff]
    ),
    c.query(
      `SELECT p.id, p.sale_id, s.coupon_number, s.customer_name, s.created_at AS sale_created_at,
              p.method, p.amount_cents, coalesce(p.cash_effective_at, p.created_at) AS paid_at, p.reference
       FROM bansir.sale_payments p
       JOIN bansir.sales s ON (s.tenant_id, s.establishment_id, s.id) = (p.tenant_id, p.establishment_id, p.sale_id)
       WHERE p.cash_session_id = $1
         AND s.cash_session_id <> $1
         AND coalesce(p.cash_effective_at, p.created_at) <= $2
       ORDER BY coalesce(p.cash_effective_at, p.created_at) ASC`,
      [cash.id, cutoff]
    )
  ]);

  const saleIds = salesRows.rows.map((row) => row.id);
  const [itemRows, paymentRows] = saleIds.length
    ? await Promise.all([
        c.query(
          `SELECT sale_id, product_id, product_name, unit, quantity, gross_cents, discount_cents
           FROM bansir.sale_items
           WHERE sale_id = ANY($1::uuid[])
           ORDER BY sale_id, position ASC`,
          [saleIds]
        ),
        c.query(
          `SELECT sale_id, method, amount_cents, coalesce(CASE WHEN cash_session_id = $2 THEN cash_effective_at END, created_at) AS paid_at, reference, cash_session_id
           FROM bansir.sale_payments
           WHERE sale_id = ANY($1::uuid[])
             AND coalesce(CASE WHEN cash_session_id = $2 THEN cash_effective_at END, created_at) <= $3
             AND (reversed_at IS NULL OR reversed_at > $3)
           ORDER BY created_at ASC`,
          [saleIds, cash.id, cutoff]
        )
      ])
    : [{ rows: [] }, { rows: [] }];

  const itemsBySale = new Map();
  for (const row of itemRows.rows) {
    if (!itemsBySale.has(row.sale_id)) itemsBySale.set(row.sale_id, []);
    itemsBySale.get(row.sale_id).push({
      productId: row.product_id,
      productName: row.product_name,
      unit: row.unit || 'un',
      quantity: Number(row.quantity),
      netCents: Number(row.gross_cents) - Number(row.discount_cents)
    });
  }

  const paymentsBySale = new Map();
  for (const row of paymentRows.rows) {
    if (!paymentsBySale.has(row.sale_id)) paymentsBySale.set(row.sale_id, []);
    paymentsBySale.get(row.sale_id).push({
      method: row.method,
      amountCents: Number(row.amount_cents),
      paidAt: row.paid_at,
      reference: row.reference || '',
      sameCashSession: row.cash_session_id === cash.id
    });
  }

  const sales = salesRows.rows.map((row) => {
    const payments = paymentsBySale.get(row.id) || [];
    const totalCents = Number(row.total_cents);
    const paidCents = payments.reduce((sum, p) => sum + p.amountCents, 0);
    const outstandingCents = row.cancelled_at ? 0 : Math.max(0, totalCents - paidCents);
    const status = row.cancelled_at ? 'cancelled' : outstandingCents > 0 ? 'pending' : 'paid';
    return {
      id: row.id,
      couponNumber: row.coupon_number,
      createdAt: row.created_at,
      customerName: row.customer_name || 'Consumidor não identificado',
      deliveryMode: row.delivery_mode,
      subtotalCents: Number(row.subtotal_cents),
      discountCents: Number(row.discount_cents),
      deliveryFeeCents: Number(row.delivery_fee_cents),
      totalCents,
      paidCents,
      outstandingCents,
      status,
      cancelledAt: row.cancelled_at || null,
      cancellationReason: row.cancellation_reason || '',
      items: itemsBySale.get(row.id) || [],
      payments
    };
  });

  const movements = [];
  let depositCents = 0;
  let withdrawalCents = 0;
  let refundCashCents = 0;
  for (const row of movementsRows.rows) {
    const amountCents = Number(row.amount_cents);
    if (row.kind === 'deposit') depositCents += amountCents;
    if (row.kind === 'withdrawal') withdrawalCents += amountCents;
    if (row.kind === 'refund') refundCashCents += amountCents;
    if (row.kind === 'deposit' || row.kind === 'withdrawal') {
      movements.push({
        id: row.id,
        kind: row.kind,
        amountCents,
        reason: row.reason,
        createdAt: row.created_at
      });
    }
  }

  const previousSalePayments = previousPaymentsRows.rows.map((row) => ({
    id: row.id,
    saleId: row.sale_id,
    couponNumber: row.coupon_number,
    customerName: row.customer_name || 'Consumidor não identificado',
    saleCreatedAt: row.sale_created_at,
    method: row.method,
    amountCents: Number(row.amount_cents),
    paidAt: row.paid_at,
    reference: row.reference || ''
  }));

  const est = establishmentRow.rows[0] || {};
  return {
    establishment: {
      name: est.name || '',
      documentId: est.document_id || ''
    },
    cash: {
      ...cashViewData,
      operator_name: cash.operator_name || ''
    },
    products,
    sales,
    movements,
    previousSalePayments,
    totals: {
      salesCount: sales.filter((s) => s.status !== 'cancelled').length,
      cancelledCount: sales.filter((s) => s.status === 'cancelled').length,
      unitsSold: products.reduce((sum, p) => sum + p.quantity, 0),
      depositCents,
      withdrawalCents,
      refundCashCents
    }
  };
}
