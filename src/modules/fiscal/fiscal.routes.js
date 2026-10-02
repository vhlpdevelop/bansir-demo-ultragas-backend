import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import {
  handleEmitNFCe,
  handleListInvoices,
  handleGetInvoice,
  handleGetFiscalConfig,
  handleUpdateFiscalConfig
} from './fiscal.controller.js';

const router = Router();
router.use(protect);

// Emissão e consulta de NFC-e / NF-e
router.post('/emit-nfce', handleEmitNFCe);
router.get('/invoices', handleListInvoices);
router.get('/invoices/:idOrChave', handleGetInvoice);

// Configuração fiscal da loja (CNPJ, IE, CSC, Certificado)
router.get('/config', requireMinHierarchy(3), handleGetFiscalConfig);
router.put('/config', requireMinHierarchy(3), handleUpdateFiscalConfig);

export default router;
