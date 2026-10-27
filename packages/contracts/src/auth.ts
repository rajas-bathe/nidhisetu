import { z } from "zod";
import { InstitutionRefSchema } from "./common.js";

/**
 * The three business roles. The login entry point (college vs officer portal)
 * is separate from the role: both officer roles share the officer login and
 * the backend decides the effective role from the authenticated account.
 */
export const UserRoleSchema = z.enum([
  "COLLEGE_USER",
  "REVIEW_OFFICER",
  "APPROVING_AUTHORITY",
]);

export type UserRole = z.infer<typeof UserRoleSchema>;

export const LoginContextSchema = z.enum(["college", "officer"]);

export type LoginContext = z.infer<typeof LoginContextSchema>;

export const LoginRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required")
    .max(320, "Email is too long")
    .toLowerCase(),
  password: z.string().min(1, "Password is required").max(200),
  /**
   * Which portal the user logged in from. Purely a guard: a college account
   * cannot authenticate through the officer portal and vice versa.
   */
  context: LoginContextSchema,
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const CurrentUserSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  fullName: z.string(),
  role: UserRoleSchema,
  institution: InstitutionRefSchema.nullable(),
});

export type CurrentUser = z.infer<typeof CurrentUserSchema>;

export const CurrentUserResponseSchema = z.object({
  user: CurrentUserSchema,
});

export type CurrentUserResponse = z.infer<typeof CurrentUserResponseSchema>;
