import { Vehicle } from './vehicle.model.js';

export async function getVehicles(req, res) {
  try {
    const vehicles = await Vehicle.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: vehicles });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function createVehicle(req, res) {
  try {
    const vehicle = await Vehicle.create(req.body);
    return res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function updateVehicle(req, res) {
  try {
    const { id } = req.params;
    const vehicle = await Vehicle.findByIdAndUpdate(id, req.body, { new: true });
    if (!vehicle) return res.status(404).json({ success: false, message: 'Veículo não encontrado' });
    return res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

export async function deleteVehicle(req, res) {
  try {
    const { id } = req.params;
    const vehicle = await Vehicle.findByIdAndDelete(id);
    if (!vehicle) return res.status(404).json({ success: false, message: 'Veículo não encontrado' });
    return res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}
