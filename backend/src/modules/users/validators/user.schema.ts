import { z } from "zod";

export const userIdParamSchema = z.object({
  id: z.string().trim().regex(/^[0-9a-fA-F]{24}$/, "Invalid user id"),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  email: z.string().trim().email("Invalid email address").transform((value) => value.toLowerCase()),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(1, "name cannot be empty").optional(),
    email: z
      .string()
      .trim()
      .email("Invalid email address")
      .transform((value) => value.toLowerCase())
      .optional(),
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "At least one field is required to update",
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
