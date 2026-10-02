export function requireFinancialAccess(section = 'financial-overview') {
  return (req, res, next) => {
    const user = req.user;
    if (['admin', 'superadmin'].includes(user?.role) || user?.allowedRoutes?.some(route => route === 'financial' || route === section)) return next();
    return res.status(403).json({ success: false, message: 'Você não tem permissão para este módulo financeiro.' });
  };
}
