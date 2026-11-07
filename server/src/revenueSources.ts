// Revenue the seller paid to their own business (Tony, Nov 7): earned revenue split into what
// independent customers paid and what came from customers linked to the seller's side, each with
// the reason it is linked. Shown to the owner and to a buyer reviewing the sale.
//
// Checked (each a reason a customer counts as linked):
// - owner_account: the customer account is the business's current owner on the contract.
// - operator: the customer account is one of the contract's operators.
// - owner_here / team_here: the account, or the person who made the request, belongs to the owner
//   or to a member of the business's team in Everstreet's records.
// - registration_paid_by_seller: the contract records that one of those accounts paid for the
//   customer's registration (the entitlement's storage payer, set by sponsor_shell).
// Not checked: money routed through other accounts (who funded a customer's tokens), or third
// parties the seller recruited. Those are said plainly in the answer, never implied away.

import type { Db } from "./db.ts";
import { accountsOfPerson } from "./members.ts";

export type LinkReason =
  | "owner_account"
  | "operator"
  | "owner_here"
  | "team_here"
  | "registration_paid_by_seller";

export const REASONS_CHECKED: LinkReason[] = [
  "owner_account",
  "operator",
  "owner_here",
  "team_here",
  "registration_paid_by_seller",
];
export const NOT_CHECKED = ["funding_through_other_accounts", "recruited_third_parties"] as const;

/** One charged use: who it was for (the customer account) and the person who asked here. */
export interface ChargedUse {
  customer_account: string;
  person_id: string;
}

/** The seller's side: the contract's owner and operators, and the owner's and team's accounts here. */
export function sellerSide(
  db: Db,
  businessId: string,
  control: { owner: string; operators: string[] },
) {
  const accounts = new Map<string, LinkReason>();
  const put = (a: string, r: LinkReason) => {
    if (!accounts.has(a)) accounts.set(a, r);
  };
  put(control.owner, "owner_account");
  for (const a of control.operators) put(a, "operator");
  const owner = (
    db.prepare("SELECT owner_id FROM businesses WHERE id = ?").get(businessId) as
      | { owner_id: string }
      | undefined
  )?.owner_id;
  const team = (
    db
      .prepare(
        `SELECT person_id FROM business_members WHERE business_id = ? AND state = 'active' AND person_id IS NOT NULL
         UNION SELECT person_id FROM team WHERE business_id = ? AND revoked_at IS NULL`,
      )
      .all(businessId, businessId) as { person_id: string }[]
  )
    .map((r) => r.person_id)
    .filter((p) => p !== owner);
  if (owner) for (const a of accountsOfPerson(db, owner)) put(a, "owner_here");
  for (const p of team) for (const a of accountsOfPerson(db, p)) put(a, "team_here");
  return { accounts, ownerPerson: owner ?? null, teamPersons: new Set(team) };
}

/**
 * Splits charged uses into independent and linked customers. `payers` is the contract's storage
 * payer per customer account (null when it couldn't be read: unless something else links that
 * customer, it is counted as unchecked, never as independent by assumption).
 */
export function revenueSources(
  uses: ChargedUse[],
  price: bigint | null,
  side: ReturnType<typeof sellerSide>,
  payers: Map<string, string | null>,
) {
  const byCustomer = new Map<string, { uses: number; persons: Set<string> }>();
  for (const u of uses) {
    const c = byCustomer.get(u.customer_account) ?? { uses: 0, persons: new Set<string>() };
    c.uses++;
    c.persons.add(u.person_id);
    byCustomer.set(u.customer_account, c);
  }
  const linked: { account: string; uses: number; reasons: LinkReason[] }[] = [];
  let independentCustomers = 0;
  let independentUses = 0;
  let uncheckedCustomers = 0;
  let uncheckedUses = 0;
  for (const [account, c] of byCustomer) {
    const reasons = new Set<LinkReason>();
    const own = side.accounts.get(account);
    if (own) reasons.add(own);
    for (const p of c.persons) {
      if (p === side.ownerPerson) reasons.add("owner_here");
      if (side.teamPersons.has(p)) reasons.add("team_here");
    }
    const payer = payers.get(account) ?? null;
    if (payer !== null && payer !== account && side.accounts.has(payer))
      reasons.add("registration_paid_by_seller");
    if (reasons.size > 0)
      linked.push({
        account,
        uses: c.uses,
        reasons: REASONS_CHECKED.filter((r) => reasons.has(r)),
      });
    else if (payer === null) {
      // Not linked by anything read, but its registration's payer wasn't read: not independent.
      uncheckedCustomers++;
      uncheckedUses += c.uses;
    } else {
      independentCustomers++;
      independentUses += c.uses;
    }
  }
  const linkedUses = linked.reduce((n, x) => n + x.uses, 0);
  const value = (n: number) => (price === null ? null : (price * BigInt(n)).toString());
  linked.sort((a, b) => b.uses - a.uses || a.account.localeCompare(b.account));
  return {
    independent: {
      customers: independentCustomers,
      uses: independentUses,
      revenue: value(independentUses),
    },
    linked: {
      customers: linked.length,
      uses: linkedUses,
      revenue: value(linkedUses),
      accounts: linked.slice(0, 20),
    },
    unchecked: {
      customers: uncheckedCustomers,
      uses: uncheckedUses,
      revenue: value(uncheckedUses),
    },
    checked: REASONS_CHECKED,
    not_checked: [...NOT_CHECKED],
  };
}
