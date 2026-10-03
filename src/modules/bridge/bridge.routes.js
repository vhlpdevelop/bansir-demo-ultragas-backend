import { Router } from 'express';
import { protect } from '../../middlewares/auth.middleware.js';
import { requireMinHierarchy } from '../../middlewares/role.middleware.js';
import { disconnectBridgeCredential, listBridgeConnections, pingBridge } from './bridge.gateway.js';
import { createBridgeCredential, listBridgeCredentials, revokeBridgeCredential } from './bridge-credential.service.js';

const router = Router();
router.use(protect, requireMinHierarchy(3));
router.get('/tokens', async (req, res, next) => {
  try { res.json({ success: true, data: await listBridgeCredentials() }); } catch (error) { next(error); }
});
router.post('/tokens', async (req, res, next) => {
  try { res.status(201).json({ success: true, data: await createBridgeCredential({ label: req.body.label, createdBy: req.user._id }) }); } catch (error) { next(error); }
});
router.delete('/tokens/:id', async (req, res, next) => {
  try {
    const credential = await revokeBridgeCredential(req.params.id);
    disconnectBridgeCredential(credential._id);
    res.json({ success: true, data: credential });
  } catch (error) { next(error); }
});
router.get('/connections', (req, res) => res.json({ success: true, data: listBridgeConnections() }));
router.post('/connections/:id/ping', async (req, res, next) => {
  try { res.json({ success: true, data: await pingBridge(req.params.id) }); }
  catch (error) { next(error); }
});
export default router;
