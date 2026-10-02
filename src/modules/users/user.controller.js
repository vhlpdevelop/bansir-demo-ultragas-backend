import {
  getAllUsers,
  getUserById,
  updateUserRole,
  updateUserStatus,
  createArtisanUser,
  updateUserPermissions,
  deleteUser
} from './user.service.js';
import { getUserDevices, removeDevice } from '../notifications/notification.service.js';

export async function list(req, res, next) {
  try {
    const users = await getAllUsers();
    return res.json({
      success: true,
      data: users
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function getOne(req, res, next) {
  try {
    const user = await getUserById(req.params.id);
    return res.json({
      success: true,
      data: user
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message
    });
  }
}

export async function changeRole(req, res, next) {
  try {
    const { role } = req.body;
    if (!role) {
      return res.status(400).json({
        success: false,
        message: 'Cargo/Papel é obrigatório.'
      });
    }

    const updated = await updateUserRole(req.params.id, role, req.user);
    return res.json({
      success: true,
      message: 'Papel hierárquico atualizado com sucesso!',
      data: updated
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function toggleStatus(req, res, next) {
  try {
    const { active } = req.body;
    const updated = await updateUserStatus(req.params.id, active);
    return res.json({
      success: true,
      message: `Status do usuário atualizado para ${active ? 'ativo' : 'inativo'}.`,
      data: updated
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function create(req, res, next) {
  try {
    const created = await createArtisanUser(req.body);
    return res.status(201).json({
      success: true,
      message: 'Usuário artesão criado com sucesso na hierarquia!',
      data: created
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function updatePermissions(req, res, next) {
  try {
    const updated = await updateUserPermissions(req.params.id, req.body);
    return res.json({
      success: true,
      message: 'Permissões e rotas atualizadas com sucesso!',
      data: updated
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function remove(req, res, next) {
  try {
    await deleteUser(req.params.id);
    return res.json({
      success: true,
      message: 'Usuário removido com sucesso.'
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function getUserDevicesHandler(req, res, next) {
  try {
    const devices = await getUserDevices(req.params.id);
    return res.json({
      success: true,
      data: devices
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function revokeUserDeviceHandler(req, res, next) {
  try {
    await removeDevice(req.params.id, req.params.deviceId);
    return res.json({
      success: true,
      message: 'Dispositivo desconectado com sucesso.'
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

