import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Package, FilePlus2, FileText, CreditCard, ShieldAlert, Receipt, BarChart3, ScrollText, Settings, LogOut, Menu, X, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ROLE_LABELS } from '../../utils/format';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'report:read', end: true },
  { to: '/customers', label: 'Customers', icon: Users, permission: 'customer:read' },
  { to: '/products', label: 'Products', icon: Package, permission: 'product:read' },
  { to: '/invoices/new', label: 'Create Invoice', icon: FilePlus2, permission: 'invoice:write' },
  { to: '/invoices', label: 'Invoice History', icon: FileText, permission: 'invoice:read', end: true },
  { to: '/payments', label: 'Payments', icon: CreditCard, permission: 'payment:read' },
  { to: '/fraud', label: 'Fraud Detection', icon: ShieldAlert, permission: 'fraud:read' },
  { to: '/tax-reports', label: 'Tax Reports', icon: Receipt, permission: 'report:read' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, permission: 'report:read' },
  { to: '/audit-logs', label: 'Audit Logs', icon: ScrollText, permission: 'audit:read' },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function SidebarContent({ onNavigate }) {
  const { user, can, logout } = useAuth();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter((i) => !i.permission || can(i.permission));
  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="rounded-lg bg-brand-600 p-1.5 text-white"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <p className="text-base font-semibold leading-tight text-white">TaxGuard AI</p>
          <p className="text-[11px] text-slate-400">Billing & fraud-risk review</p>
        </div>
      </div>
      <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'bg-brand-600 text-white' : 'hover:bg-slate-800 hover:text-white'}`}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <div className="mb-2 px-3">
          <p className="truncate text-sm font-medium text-white">{user?.name}</p>
          <p className="text-xs text-slate-400">{ROLE_LABELS[user?.role] || user?.role}</p>
        </div>
        <button type="button" onClick={async () => { await logout(); navigate('/login'); }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-800 hover:text-white">
          <LogOut className="h-4 w-4" aria-hidden="true" />Logout
        </button>
      </div>
    </div>
  );
}

export default function AppLayout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block"><SidebarContent /></aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw]">
            <SidebarContent onNavigate={() => setOpen(false)} />
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-4 rounded p-1 text-slate-300 hover:bg-slate-800"><X className="h-5 w-5" /></button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-1.5 text-slate-600 hover:bg-slate-100"><Menu className="h-5 w-5" /></button>
        <span className="font-semibold text-slate-900">TaxGuard AI</span>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
        <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500">
          Educational project. Figures are recorded values, not verified tax liability; fraud alerts are indicators for human review, not findings of wrongdoing.
        </footer>
      </main>
    </div>
  );
}
