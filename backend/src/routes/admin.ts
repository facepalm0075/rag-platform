import express, { Router } from 'express';
import { requireAdmin } from '../middleware/adminAuth.js';
import * as adminController from '../controllers/admin.js';

const router = Router();

router.use(requireAdmin);
router.use(express.urlencoded({ extended: false }));

router.get('/login', adminController.loginPage);
router.post('/login', adminController.login);
router.get('/logout', adminController.logout);
router.get('/', adminController.dashboard);

export default router;
