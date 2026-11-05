// Plain words for service-readiness reasons (shared by the sale room and customer access).

export const SERVICE_WORDS: Record<string, string> = {
  handover_in_progress: "the handover is still in progress",
  no_active_offer: "no customer offer is active",
  release_not_active: "the offer's release isn't the active one",
  writer_unavailable: "reserving and settling units isn't connected on this server",
  protection_unavailable: "private results can't be kept on this server",
  metering_not_appointed: "the platform's metering account isn't appointed for the new owner",
  runtime_budget_unset: "no running budget is set",
  runtime_budget_exhausted: "the running budget is used up",
};
export const serviceWord = (r: string) =>
  SERVICE_WORDS[r] ??
  (r.startsWith("runtime_unavailable")
    ? "the product can't run on this server now"
    : r.startsWith("release_")
      ? "the released product can't serve as it is configured now"
      : r);
