import { ROLE_HIERARCHY, USER_ROLES } from '../modules/users/user.model.js';

/**
 * Restricts access to specific roles
 * @param  {...string} allowedRoles
 */
export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Acesso negado. Ação restrita aos cargos: ${allowedRoles.join(', ')}. Seu perfil atual é: ${req.user.role}.`,
        code: 'FORBIDDEN'
      });
    }

    next();
  };
}

/**
 * Restricts access based on minimum hierarchy level
 * @param {number} minLevel 1=Operador, 2=Gerente Artesão, 3=Admin, 4=Superadmin
 */
export function requireMinHierarchy(minLevel) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] || 0;

    if (userLevel < minLevel) {
      return res.status(403).json({
        success: false,
        message: `Nível de privilégio insuficiente. Nível necessário: ${minLevel}, nível do usuário: ${userLevel} (${req.user.role}).`,
        code: 'FORBIDDEN'
      });
    }

    next();
  };
}

/**
 * RBAC: Restricts access to a specific route/module based on user role or allowedRoutes
 * Superadmin and Admin always have full access. Other roles require the route in user.allowedRoutes.
 * @param {string} routeKey (e.g. 'reports', 'suppliers', 'products', 'financial', 'sales')
 */
export function requireRoutePermission(routeKey) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    const isAdmin = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.SUPERADMIN;
    const hasRoutePermission = Array.isArray(req.user.allowedRoutes) && req.user.allowedRoutes.includes(routeKey);

    if (isAdmin || hasRoutePermission) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Acesso negado pelo RBAC. Seu usuário (${req.user.name || req.user.role}) não possui permissão para acessar o módulo '${routeKey}'.`,
      code: 'FORBIDDEN'
    });
  };
}

/**
 * RBAC: Restricts access allowing users that match ANY of the specified routes or are admins
 * @param  {...string} routeKeys
 */
export function requireAnyPermission(...routeKeys) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Acesso não autorizado.',
        code: 'UNAUTHORIZED'
      });
    }

    const isAdmin = req.user.role === USER_ROLES.ADMIN || req.user.role === USER_ROLES.SUPERADMIN;
    const hasAnyRoute = Array.isArray(req.user.allowedRoutes) && 
      routeKeys.some(key => req.user.allowedRoutes.includes(key));

    if (isAdmin || hasAnyRoute) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Acesso negado pelo RBAC. Privilégios insuficientes para esta operação.`,
      code: 'FORBIDDEN'
    });
  };
}
