import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { StoreProvider, useStore } from './lib/store';
import Ads from './pages/Ads';
import Behavior from './pages/Behavior';
import Billing from './pages/Billing';
import { AcceptInvite, ResetPassword } from './pages/AuthPages';
import Platform from './pages/Platform';
import Blocks from './pages/Blocks';
import Calendar from './pages/Calendar';
import Channels from './pages/Channels';
import Content from './pages/Content';
import PostEditor from './pages/PostEditor';
import ContactPage from './pages/ContactPage';
import Contacts from './pages/Contacts';
import Dashboard from './pages/Dashboard';
import Deals from './pages/Deals';
import Integrations from './pages/Integrations';
import Login from './pages/Login';
import Sales from './pages/Sales';
import Settings from './pages/Settings';
import Tasks from './pages/Tasks';
import Traffic from './pages/Traffic';

function Routed() {
  const { me, loading } = useStore();
  if (loading) return <Loading />;
  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  // Не оплачено — доступна только страница оплаты (и кабинет владельца платформы)
  if (me.billing?.status === 'frozen') {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route path="billing" element={<Billing />} />
          {me.is_superadmin && <Route path="platform" element={<Platform />} />}
        </Route>
        <Route path="*" element={<Navigate to="/billing" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="traffic" element={<Traffic />} />
        <Route path="behavior" element={<Behavior />} />
        <Route path="sales" element={<Sales />} />
        <Route path="ads" element={<Ads />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="contacts/:id" element={<ContactPage />} />
        <Route path="deals" element={<Deals />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="content" element={<Content />} />
        <Route path="content/:id" element={<PostEditor />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="blocks" element={<Blocks />} />
        <Route path="channels" element={<Channels />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="settings" element={<Settings />} />
        <Route path="billing" element={<Billing />} />
        {me.is_superadmin && <Route path="platform" element={<Platform />} />}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Routes>
          {/* ссылки из писем открываются и без входа */}
          <Route path="/reset" element={<ResetPassword />} />
          <Route path="/invite" element={<AcceptInvite />} />
          <Route path="*" element={<Routed />} />
        </Routes>
      </HashRouter>
    </StoreProvider>
  );
}
