import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, basicAuthHeader, hasAuth, setAuth, setUnauthorizedHandler } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!hasAuth());

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!hasAuth()) return;
    apiGet('/me')
      .then(setUser)
      .catch(() => setAuth(null))
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (username, password) => {
    setAuth(basicAuthHeader(username.trim(), password));
    try {
      const me = await apiGet('/me');
      setUser(me);
      return me;
    } catch (err) {
      setAuth(null);
      if (err.status === 401) throw new Error('Invalid username or password.');
      throw err;
    }
  }, []);

  const logout = useCallback(() => {
    setAuth(null);
    setUser(null);
  }, []);

  const hasRole = useCallback((...roles) => Boolean(user && roles.includes(user.role)), [user]);

  const value = useMemo(() => ({ user, ready, login, logout, hasRole }), [user, ready, login, logout, hasRole]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export const APPROVER_ROLES = ['MANAGER', 'FINANCE_AUDITOR', 'FINANCE_HEAD'];

export const ROLE_LABELS = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  FINANCE_AUDITOR: 'Finance Auditor',
  FINANCE_HEAD: 'Finance Head',
};
