export const roles = {
  platform_admin: {
    label: "Platform Admin",
    home: "overview",
    read: [
      "fleet",
      "routes",
      "trips",
      "students",
      "alerts",
      "maintenance",
      "fuel",
      "sms",
      "devices",
      "reports",
      "users",
      "audit",
      "schools",
      "connections",
    ],
    write: [
      "fleet",
      "routes",
      "trips",
      "students",
      "alerts",
      "maintenance",
      "fuel",
      "sms",
      "devices",
      "users",
      "schools",
      "connections",
    ],
  },
  school_admin: {
    label: "School Admin",
    home: "overview",
    read: [
      "fleet",
      "routes",
      "trips",
      "students",
      "alerts",
      "maintenance",
      "fuel",
      "sms",
      "devices",
      "reports",
      "users",
      "audit",
    ],
    write: [
      "fleet",
      "routes",
      "trips",
      "students",
      "alerts",
      "maintenance",
      "fuel",
      "sms",
      "users",
    ],
  },
  transport_officer: {
    label: "Transport Officer",
    home: "overview",
    read: [
      "fleet",
      "routes",
      "trips",
      "students",
      "alerts",
      "maintenance",
      "devices",
      "reports",
    ],
    write: ["fleet", "routes", "trips", "students", "alerts"],
  },
  dispatcher: {
    label: "Dispatcher",
    home: "trips",
    read: ["fleet", "routes", "trips", "students", "alerts", "devices"],
    write: ["trips", "alerts"],
  },
  driver: {
    label: "Driver",
    home: "trips",
    read: ["trips", "students"],
    write: ["boarding"],
  },
  maintenance_officer: {
    label: "Maintenance Officer",
    home: "maintenance",
    read: ["fleet", "maintenance", "devices"],
    write: ["maintenance"],
  },
  finance_officer: {
    label: "Finance Officer",
    home: "fuel",
    read: ["fuel", "maintenance", "reports"],
    write: ["fuel"],
  },
  guardian: {
    label: "Guardian / Parent",
    home: "children",
    read: ["children"],
    write: [],
  },
  auditor: {
    label: "Auditor",
    home: "reports",
    read: ["reports", "audit"],
    write: [],
  },
};
export const eventRoles = {
  fleet: ["school_admin", "transport_officer"],
  routes: ["school_admin", "transport_officer", "dispatcher"],
  trips: ["school_admin", "transport_officer", "dispatcher"],
  students: ["school_admin", "transport_officer"],
  alerts: ["school_admin", "transport_officer", "dispatcher"],
  maintenance: ["school_admin", "maintenance_officer"],
  fuel: ["school_admin", "finance_officer"],
  sms: ["school_admin"],
  devices: ["school_admin", "transport_officer", "maintenance_officer"],
  users: ["school_admin"],
  schools: [],
  connections: [],
};
export const safeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  schoolId: user.schoolId,
  roles: user.roles,
  active: user.active,
  photo: user.photo || "",
  phone: user.phone || "",
  bio: user.bio || "",
});
export const has = (session, action, resource) =>
  roles[session.role]?.[action]?.includes(resource) || false;
export function scope(user, session, requested) {
  if (session.role === "platform_admin") return requested || null;
  return user.schoolId;
}
export function visibleRecords(state, user, session, resource, schoolId) {
  let records = state.records.filter(
    (r) => r.collection === resource && (!schoolId || r.schoolId === schoolId),
  );
  if (session.role === "driver") {
    const trips = state.records.filter(
      (r) =>
        r.collection === "trips" &&
        r.schoolId === user.schoolId &&
        r.driverId === user.id,
    );
    const tripIds = new Set(trips.map((r) => r.id));
    records =
      resource === "trips"
        ? records.filter((r) => r.driverId === user.id)
        : records.filter((r) => r.tripIds?.some((id) => tripIds.has(id)));
  }
  return records;
}
