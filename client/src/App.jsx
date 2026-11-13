import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Products from './pages/Products';
import CreateInvoice from './pages/CreateInvoice';
import InvoiceHistory from './pages/InvoiceHistory';
import Payments from './pages/Payments';
import FraudDetection from './pages/FraudDetection';
import TaxReports from './pages/TaxReports';
import Analytics from './pages/Analytics';
import AuditLogs from './pages/AuditLogs';
import Settings from './pages/Settings';

const guard = (permission, element) => <ProtectedRoute permission={permission}>{element}</ProtectedRoute>;

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={guard('report:read', <Dashboard />)} />
        <Route path="customers" element={guard('customer:read', <Customers />)} />
        <Route path="products" element={guard('product:read', <Products />)} />
        <Route path="invoices/new" element={guard('invoice:write', <CreateInvoice />)} />
        <Route path="invoices" element={guard('invoice:read', <InvoiceHistory />)} />
        <Route path="payments" element={guard('payment:read', <Payments />)} />
        <Route path="fraud" element={guard('fraud:read', <FraudDetection />)} />
        <Route path="tax-reports" element={guard('report:read', <TaxReports />)} />
        <Route path="analytics" element={guard('report:read', <Analytics />)} />
        <Route path="audit-logs" element={guard('audit:read', <AuditLogs />)} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
