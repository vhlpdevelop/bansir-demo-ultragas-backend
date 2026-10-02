import * as supplierService from './supplier.service.js';

export async function listSuppliers(req, res, next) {
  try {
    const suppliers = await supplierService.getAllSuppliers(req.query);
    res.json({
      success: true,
      count: suppliers.length,
      data: suppliers
    });
  } catch (error) {
    next(error);
  }
}

export async function getSupplier(req, res, next) {
  try {
    const supplier = await supplierService.getSupplierById(req.params.id);
    res.json({
      success: true,
      data: supplier
    });
  } catch (error) {
    next(error);
  }
}

export async function createSupplier(req, res, next) {
  try {
    const newSupplier = await supplierService.createSupplier(req.body);
    res.status(201).json({
      success: true,
      message: 'Fornecedor cadastrado com sucesso!',
      data: newSupplier
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSupplier(req, res, next) {
  try {
    const updated = await supplierService.updateSupplier(req.params.id, req.body);
    res.json({
      success: true,
      message: 'Fornecedor atualizado com sucesso!',
      data: updated
    });
  } catch (error) {
    next(error);
  }
}

export async function deleteSupplier(req, res, next) {
  try {
    const deactivated = await supplierService.deleteSupplier(req.params.id);
    res.json({
      success: true,
      message: 'Fornecedor desativado com sucesso.',
      data: deactivated
    });
  } catch (error) {
    next(error);
  }
}
