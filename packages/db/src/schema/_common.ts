import { timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};
