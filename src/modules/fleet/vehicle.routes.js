import { Router } from 'express';
import * as vehicleController from './vehicle.controller.js';

const router = Router();

router.get('/', vehicleController.getVehicles);
router.post('/', vehicleController.createVehicle);
router.put('/:id', vehicleController.updateVehicle);
router.delete('/:id', vehicleController.deleteVehicle);

export default router;
