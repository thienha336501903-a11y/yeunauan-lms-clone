function clean(value) {
  return String(value || "").trim();
}

function lowerEmail(value) {
  return clean(value).toLowerCase();
}

export async function findAuthUserByEmail(client, email, options = {}) {
  const target = lowerEmail(email);
  if (!client?.auth?.admin?.listUsers) throw new Error("auth_admin_client_required");
  if (!target) return { ok: false, code: "invalid_email" };

  const perPage = Math.max(1, Math.min(Number(options.perPage) || 200, 1000));
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 100, 500));
  let found = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) return { ok: false, code: "auth_user_lookup_failed", error };

    const users = Array.isArray(data?.users) ? data.users : [];
    for (const user of users) {
      if (lowerEmail(user?.email) !== target) continue;
      if (found && String(found.id) !== String(user.id)) {
        return { ok: false, code: "auth_user_email_ambiguous" };
      }
      found = user;
    }

    if (users.length < perPage) break;
    if (page === maxPages) {
      return { ok: false, code: "auth_user_lookup_page_limit" };
    }
  }

  return found
    ? { ok: true, found: true, user: found }
    : { ok: true, found: false, user: null };
}

export async function prepareAuthPrincipal(client, declaration, options = {}) {
  const email = lowerEmail(declaration?.email);
  const suppliedUserId = clean(declaration?.user_id);
  const mode = clean(options.mode || "reuse_only");

  if (!client?.auth?.admin) throw new Error("auth_admin_client_required");
  if (!email && !suppliedUserId) {
    return { ok: false, status: 400, code: "principal_identity_required" };
  }

  if (suppliedUserId) {
    if (!client.auth.admin.getUserById) {
      return { ok: false, status: 500, code: "auth_get_user_by_id_unavailable" };
    }
    const { data, error } = await client.auth.admin.getUserById(suppliedUserId);
    const user = data?.user || null;
    if (error || !user?.id) {
      return { ok: false, status: 404, code: "auth_user_id_not_found" };
    }
    if (email && lowerEmail(user.email) !== email) {
      return { ok: false, status: 409, code: "principal_identity_mismatch" };
    }
    return {
      ok: true,
      created: false,
      reused: true,
      user: { id: user.id, email: lowerEmail(user.email) }
    };
  }

  const lookup = await findAuthUserByEmail(client, email, options);
  if (!lookup.ok) return { ok: false, status: 500, code: lookup.code, error: lookup.error };
  if (lookup.found) {
    return {
      ok: true,
      created: false,
      reused: true,
      user: { id: lookup.user.id, email: lowerEmail(lookup.user.email) }
    };
  }

  if (mode !== "create_if_missing" || options.allowCreate !== true) {
    return { ok: false, status: 409, code: "auth_principal_not_prepared" };
  }

  // Deliberately does not send an invite email. The current Agency Google bridge
  // later proves control of the verified Google email before minting a session.
  const { data, error } = await client.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      system_b_factory: true
    }
  });

  if (error || !data?.user?.id) {
    return { ok: false, status: 500, code: "auth_principal_create_failed", error };
  }

  return {
    ok: true,
    created: true,
    reused: false,
    user: { id: data.user.id, email: lowerEmail(data.user.email) }
  };
}
