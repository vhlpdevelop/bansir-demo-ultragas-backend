const admin=m=>['admin','superadmin'].includes(m.role);
export const manageDeliveries=m=>admin(m)||m.allowed_routes?.some(r=>['deliveries-manage','sales-manage'].includes(r));
export const driveDeliveries=m=>m.role==='entregador'||m.allowed_routes?.includes('my-deliveries');
export const monitorDeliveries=m=>admin(m)||(m.allowed_routes?.includes('dashboard')&&m.allowed_routes?.includes('delivery-monitor'));
