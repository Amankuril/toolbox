export function serializeUser(user) {
  if (!user) return null;
  return {
    _id: user._id,
    role: 'user',
    phone: user.phone,
    name: user.name,
    email: user.email ?? null,
    accountType: user.accountType,
    business: user.accountType === 'business' ? { name: user.business?.name ?? null, gstin: user.business?.gstin ?? null } : null,
    avatar: user.avatar ?? null,
    status: user.status,
    createdAt: user.createdAt,
  };
}
