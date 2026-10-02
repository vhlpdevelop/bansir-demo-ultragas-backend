import { closeCashRegister, getCashRegisterHistory } from './cash-register.service.js';

export async function closeRegister(req, res) {
  try {
    const closure = await closeCashRegister(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: 'Caixa fechado com sucesso!',
      data: closure
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function getHistory(req, res) {
  try {
    const history = await getCashRegisterHistory();
    return res.json({
      success: true,
      data: history
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}
