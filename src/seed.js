import { randomUUID } from "node:crypto";
import { hashPassword } from "./identity-store.js";
import { roles } from "./access.js";
export async function seedDemo(store, password) {
  const passwordHash = await hashPassword(password);
  await store.transaction((state) => {
    if (state.users.length) return;
    state.schools.push(
      { id: "mbeya-pilot", name: "Mbeya School · Demo" },
      { id: "arusha-demo", name: "Arusha School · Isolation test" },
    );
    for (const [role, info] of Object.entries(roles))
      state.users.push({
        id: `demo-${role}`,
        name: info.label,
        email: `${role}@demo.falconfleet.test`,
        passwordHash,
        roles: [role],
        schoolId: role === "platform_admin" ? null : "mbeya-pilot",
        active: true,
      });
    state.records.push(
      {
        id: "demo-trip",
        schoolId: "mbeya-pilot",
        collection: "trips",
        name: "Morning · Uyole",
        detail: "BUS-03",
        driverId: "demo-driver",
        status: "In progress",
      },
      {
        id: "demo-student",
        schoolId: "mbeya-pilot",
        collection: "students",
        name: "Demo pupil A",
        detail: "Assigned to morning trip",
        guardianIds: ["demo-guardian"],
        tripIds: ["demo-trip"],
        status: "Assigned",
      },
      {
        id: "other-student",
        schoolId: "arusha-demo",
        collection: "students",
        name: "Other school pupil",
        guardianIds: [],
        tripIds: [],
        status: "Assigned",
      },
      {
        id: "demo-bus",
        schoolId: "mbeya-pilot",
        collection: "fleet",
        name: "BUS-03",
        detail: "T 309 DMC · 30 seats",
        status: "Active",
      },
      {
        id: "demo-route",
        schoolId: "mbeya-pilot",
        collection: "routes",
        name: "Uyole · School",
        detail: "Illustrative route · field survey pending",
        status: "Draft",
      },
      {
        id: "demo-alert",
        schoolId: "mbeya-pilot",
        collection: "alerts",
        name: "GPS offline review",
        detail: "BUS-03 · simulated incident",
        status: "Open",
      },
      {
        id: "demo-maintenance",
        schoolId: "mbeya-pilot",
        collection: "maintenance",
        name: "BUS-03 service",
        detail: "Brake inspection",
        status: "Reported",
        amount: 80000,
      },
      {
        id: "demo-fuel",
        schoolId: "mbeya-pilot",
        collection: "fuel",
        name: "Diesel purchase",
        detail: "BUS-03 · sample receipt",
        status: "Pending",
        amount: 120000,
      },
    );
    for (const user of state.users)
      state.notifications.push({
        id: randomUUID(),
        userId: user.id,
        schoolId: user.schoolId,
        role: user.roles[0],
        message: `Welcome to your ${roles[user.roles[0]].label} workspace. Synthetic demo records only.`,
        read: false,
        time: Date.now(),
        resource: "system",
      });
  });
}
