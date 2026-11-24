// Deliberately isolated Worker shell. No privileged operations are implemented.
import { findApprovedConflict } from "./booking-core.js";

export { findApprovedConflict };

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        mode: "isolated-prototype",
        privilegedOperationsEnabled: false
      });
    }

    return Response.json({
      error: "Not implemented. This prototype is not connected to Firebase."
    }, { status: 501 });
  }
};
