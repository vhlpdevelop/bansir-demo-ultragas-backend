export const isSettingsAdmin=m=>['admin','superadmin'].includes(m.role);
export const delegatedSetting=(m,key)=>isSettingsAdmin(m)||m.allowed_routes?.includes(key);
export function settingsModule(path){
 if(/^\/api\/v1\/fiscal\/(settings|certificate|monitor|recipients)(?:\/|$)/.test(path))return 'settings-fiscal';
 if(/^\/api\/v1\/(bridge|settings\/hardware)(?:\/|$)/.test(path))return 'settings-terminals';
 if(/^\/api\/v1\/whatsapp(?:\/|$)/.test(path))return 'settings-whatsapp';
 if(path==='/api/v1/settings'||path==='/api/v1/storefront/settings')return 'settings-store';
}
