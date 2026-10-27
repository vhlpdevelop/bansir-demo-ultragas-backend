// Legacy MongoDB mode cannot pair devices. Production WhatsApp uses Meta in PostgreSQL.
export const whatsappService={getStatus:()=>({provider:'meta',status:'NOT_CONFIGURED',requiresPostgres:true}),initialize(){throw new Error('Use a integração Meta no ambiente PostgreSQL.');},async logout(){},async sendMessage(){return false;},async sendMessageWithImage(){return false;}};
