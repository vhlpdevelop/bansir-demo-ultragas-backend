import { loginUser, registerUser, getProfile } from './auth.service.js';

export async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Por favor, informe e-mail e senha.'
      });
    }

    const result = await loginUser(email, password);
    return res.json({
      success: true,
      message: 'Login realizado com sucesso no Bansir SaaS!',
      data: result
    });
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.message || 'Falha na autenticação.'
    });
  }
}

export async function register(req, res, next) {
  try {
    const { name, email, password, role, artisanSpecialty, phone } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nome, e-mail e senha são obrigatórios.'
      });
    }

    const result = await registerUser({ name, email, password, role, artisanSpecialty, phone });
    return res.status(201).json({
      success: true,
      message: 'Usuário registrado com sucesso!',
      data: result
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Erro ao registrar usuário.'
    });
  }
}

export async function getMe(req, res, next) {
  try {
    const user = await getProfile(req.user._id || req.user.id);
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
