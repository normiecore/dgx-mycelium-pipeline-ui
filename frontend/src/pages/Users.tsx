import React, { useEffect, useState, useCallback } from 'react';
import { getUsers, getDepartments, updateUser, syncUserStats, getUser } from '../api';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';

interface UserStats {
  userId: string;
  totalCaptures: number;
  totalApproved: number;
  totalDismissed: number;
  lastCaptureAt: string | null;
}

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  department: string;
  role: string;
  harvestingEnabled: number;
  createdAt: string;
  updatedAt: string;
  stats: UserStats;
}

interface Department {
  department: string;
  count: number;
}

interface EngramRow {
  id: string;
  concept: string;
  approvalStatus: string;
  capturedAt: string;
  sourceType: string;
  confidence: number;
}

type SortKey = 'displayName' | 'department' | 'role' | 'totalCaptures' | 'totalApproved' | 'lastCaptureAt' | 'harvestingEnabled';
type SortDir = 'asc' | 'desc';

export default function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('displayName');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Detail drawer
  const [drawerUserId, setDrawerUserId] = useState<string | null>(null);
  const [drawerUser, setDrawerUser] = useState<UserRow | null>(null);
  const [drawerEngrams, setDrawerEngrams] = useState<EngramRow[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);

  const { addToast } = useToast();

  const loadUsers = useCallback(async () => {
    try {
      setError(null);
      const data = await getUsers(page, limit, selectedDept || undefined, search || undefined);
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch {
      setError('Failed to load users.');
    }
    setLoading(false);
  }, [page, limit, selectedDept, search]);

  const loadDepartments = useCallback(async () => {
    try {
      const data = await getDepartments();
      setDepartments(data.departments || []);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadDepartments(); }, [loadDepartments]);

  // Detail drawer
  useEffect(() => {
    if (!drawerUserId) {
      setDrawerUser(null);
      setDrawerEngrams([]);
      return;
    }
    setDrawerLoading(true);
    getUser(drawerUserId)
      .then((data) => {
        setDrawerUser({ ...data.user, stats: data.stats });
        setDrawerEngrams(data.recentEngrams || []);
      })
      .catch(() => addToast('error', 'Failed to load user details'))
      .finally(() => setDrawerLoading(false));
  }, [drawerUserId, addToast]);

  const handleToggleHarvesting = async (user: UserRow) => {
    const newVal = !user.harvestingEnabled;
    try {
      await updateUser(user.id, { harvestingEnabled: newVal });
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, harvestingEnabled: newVal ? 1 : 0 } : u)),
      );
      addToast('success', `Harvesting ${newVal ? 'enabled' : 'disabled'} for ${user.displayName || user.email}`);
    } catch {
      addToast('error', 'Failed to update harvesting status');
    }
  };

  const handleRoleChange = async (user: UserRow, role: string) => {
    try {
      await updateUser(user.id, { role });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, role } : u)));
      addToast('success', `Role updated to ${role} for ${user.displayName || user.email}`);
    } catch {
      addToast('error', 'Failed to update role');
    }
  };

  const handleDeptChange = async (user: UserRow, department: string) => {
    try {
      await updateUser(user.id, { department });
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, department } : u)));
      addToast('success', `Department updated for ${user.displayName || user.email}`);
    } catch {
      addToast('error', 'Failed to update department');
    }
  };

  const handleSyncStats = async (userId: string) => {
    try {
      const data = await syncUserStats(userId);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, stats: data.stats } : u)),
      );
      addToast('success', 'Stats synced from engram index');
    } catch {
      addToast('error', 'Failed to sync stats');
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (sortKey) {
      case 'totalCaptures':
        aVal = a.stats.totalCaptures;
        bVal = b.stats.totalCaptures;
        break;
      case 'totalApproved':
        aVal = a.stats.totalApproved;
        bVal = b.stats.totalApproved;
        break;
      case 'lastCaptureAt':
        aVal = a.stats.lastCaptureAt || '';
        bVal = b.stats.lastCaptureAt || '';
        break;
      case 'harvestingEnabled':
        aVal = a.harvestingEnabled;
        bVal = b.harvestingEnabled;
        break;
      default:
        aVal = (a[sortKey] || '').toString().toLowerCase();
        bVal = (b[sortKey] || '').toString().toLowerCase();
    }

    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(total / limit);
  const totalDeptUsers = departments.reduce((s, d) => s + d.count, 0);
  const activeToday = users.filter((u) => {
    if (!u.stats.lastCaptureAt) return false;
    const today = new Date().toISOString().slice(0, 10);
    return u.stats.lastCaptureAt.slice(0, 10) === today;
  }).length;

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ^' : ' v';
  };

  if (loading) {
    return (
      <div className="page users-page">
        <h2>User Management</h2>
        <p className="page-subtitle">Loading users...</p>
        <SkeletonCard count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page users-page">
        <h2>User Management</h2>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={loadUsers}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page users-page">
      <h2>User Management</h2>
      <p className="page-subtitle">Manage users, departments, and harvesting settings</p>

      {/* Summary cards */}
      <div className="users-summary">
        <div className="users-summary-card">
          <span className="users-summary-value">{total}</span>
          <span className="users-summary-label">Total Users</span>
        </div>
        <div className="users-summary-card">
          <span className="users-summary-value">{activeToday}</span>
          <span className="users-summary-label">Active Today</span>
        </div>
        <div className="users-summary-card">
          <span className="users-summary-value">{departments.length}</span>
          <span className="users-summary-label">Departments</span>
        </div>
        <div className="users-summary-card">
          <span className="users-summary-value">
            {users.filter((u) => u.harvestingEnabled).length}
          </span>
          <span className="users-summary-label">Harvesting On</span>
        </div>
      </div>

      {/* Department breakdown */}
      {departments.length > 0 && (
        <div className="users-dept-chips">
          {departments.map((d) => (
            <button
              key={d.department}
              className={`users-dept-chip ${selectedDept === d.department ? 'active' : ''}`}
              onClick={() => {
                setSelectedDept(selectedDept === d.department ? '' : d.department);
                setPage(1);
              }}
            >
              {d.department} ({d.count})
            </button>
          ))}
          {selectedDept && (
            <button
              className="users-dept-chip users-dept-clear"
              onClick={() => { setSelectedDept(''); setPage(1); }}
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Search + filter toolbar */}
      <form className="users-toolbar" onSubmit={handleSearch}>
        <input
          type="text"
          className="search-input"
          placeholder="Search by name or email..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="submit" className="btn-search">Search</button>
        {search && (
          <button
            type="button"
            className="users-dept-chip users-dept-clear"
            onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}
          >
            Clear
          </button>
        )}
      </form>

      {/* User table */}
      {sortedUsers.length === 0 ? (
        <div className="empty-state">No users found.</div>
      ) : (
        <>
          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th className="users-th-sortable" onClick={() => handleSort('displayName')}>
                    Name{sortIndicator('displayName')}
                  </th>
                  <th className="users-th-sortable" onClick={() => handleSort('department')}>
                    Department{sortIndicator('department')}
                  </th>
                  <th className="users-th-sortable" onClick={() => handleSort('role')}>
                    Role{sortIndicator('role')}
                  </th>
                  <th className="users-th-sortable" onClick={() => handleSort('totalCaptures')}>
                    Captures{sortIndicator('totalCaptures')}
                  </th>
                  <th className="users-th-sortable" onClick={() => handleSort('totalApproved')}>
                    Approved{sortIndicator('totalApproved')}
                  </th>
                  <th className="users-th-sortable" onClick={() => handleSort('lastCaptureAt')}>
                    Last Active{sortIndicator('lastCaptureAt')}
                  </th>
                  <th className="users-th-sortable" onClick={() => handleSort('harvestingEnabled')}>
                    Harvesting{sortIndicator('harvestingEnabled')}
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="users-row"
                    onClick={() => setDrawerUserId(drawerUserId === user.id ? null : user.id)}
                  >
                    <td>
                      <div className="users-name-cell">
                        <span className="users-display-name">{user.displayName || '--'}</span>
                        <span className="users-email">{user.email}</span>
                      </div>
                    </td>
                    <td>
                      <select
                        className="users-inline-select"
                        value={user.department}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleDeptChange(user, e.target.value)}
                      >
                        <option value="">(none)</option>
                        {departments.map((d) => (
                          <option key={d.department} value={d.department}>{d.department}</option>
                        ))}
                        {user.department && !departments.find((d) => d.department === user.department) && (
                          <option value={user.department}>{user.department}</option>
                        )}
                      </select>
                    </td>
                    <td>
                      <select
                        className="users-inline-select"
                        value={user.role}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleRoleChange(user, e.target.value)}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="users-num">{user.stats.totalCaptures}</td>
                    <td className="users-num">{user.stats.totalApproved}</td>
                    <td className="users-date">
                      {user.stats.lastCaptureAt
                        ? new Date(user.stats.lastCaptureAt).toLocaleDateString()
                        : '--'}
                    </td>
                    <td>
                      <button
                        className={`users-toggle ${user.harvestingEnabled ? 'on' : 'off'}`}
                        onClick={(e) => { e.stopPropagation(); handleToggleHarvesting(user); }}
                        title={user.harvestingEnabled ? 'Disable harvesting' : 'Enable harvesting'}
                      >
                        {user.harvestingEnabled ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td>
                      <button
                        className="users-sync-btn"
                        onClick={(e) => { e.stopPropagation(); handleSyncStats(user.id); }}
                        title="Recalculate stats from engram index"
                      >
                        Sync
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="users-pagination">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {/* Detail drawer */}
      {drawerUserId && (
        <div className="users-drawer-overlay" onClick={() => setDrawerUserId(null)}>
          <div className="users-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="users-drawer-header">
              <h3>User Details</h3>
              <button className="users-drawer-close" onClick={() => setDrawerUserId(null)}>
                &#x2715;
              </button>
            </div>

            {drawerLoading ? (
              <div className="page-loading"><div className="spinner" /></div>
            ) : drawerUser ? (
              <div className="users-drawer-body">
                <div className="users-drawer-profile">
                  <h4>{drawerUser.displayName || drawerUser.email}</h4>
                  <p className="users-drawer-email">{drawerUser.email}</p>
                  <div className="users-drawer-meta">
                    <span>Department: {drawerUser.department || '--'}</span>
                    <span>Role: {drawerUser.role}</span>
                    <span>Harvesting: {drawerUser.harvestingEnabled ? 'Enabled' : 'Disabled'}</span>
                    <span>Joined: {new Date(drawerUser.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="users-drawer-stats">
                  <div className="users-drawer-stat">
                    <span className="users-drawer-stat-val">{drawerUser.stats.totalCaptures}</span>
                    <span className="users-drawer-stat-lbl">Captures</span>
                  </div>
                  <div className="users-drawer-stat">
                    <span className="users-drawer-stat-val">{drawerUser.stats.totalApproved}</span>
                    <span className="users-drawer-stat-lbl">Approved</span>
                  </div>
                  <div className="users-drawer-stat">
                    <span className="users-drawer-stat-val">{drawerUser.stats.totalDismissed}</span>
                    <span className="users-drawer-stat-lbl">Dismissed</span>
                  </div>
                </div>

                {drawerEngrams.length > 0 && (
                  <div className="users-drawer-engrams">
                    <h4>Recent Engrams</h4>
                    <div className="engram-list">
                      {drawerEngrams.map((eng) => (
                        <div key={eng.id} className="engram-card">
                          <div className="engram-header">
                            <div className="engram-info">
                              <h3 className="engram-title">{eng.concept}</h3>
                              <div className="engram-meta">
                                <span className={`engram-source ${eng.sourceType.startsWith('graph_') ? 'source-cloud' : 'source-desktop'}`}>
                                  {eng.sourceType}
                                </span>
                                <span className="engram-separator">&bull;</span>
                                <span>{new Date(eng.capturedAt).toLocaleDateString()}</span>
                                <span className="engram-separator">&bull;</span>
                                <span className={`confidence-badge ${eng.confidence >= 0.8 ? 'high' : eng.confidence >= 0.5 ? 'medium' : 'low'}`}>
                                  {(eng.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                            </div>
                            <span className={`sensitivity-badge ${eng.approvalStatus === 'approved' ? 'safe' : eng.approvalStatus === 'dismissed' ? 'block' : 'review'}`}>
                              {eng.approvalStatus}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="empty-state">User not found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
