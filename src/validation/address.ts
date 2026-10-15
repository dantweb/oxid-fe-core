import { z } from 'zod';

/**
 * Form schema for the storefront's invoice/delivery address inputs.
 * Field names follow the GraphQL Storefront address types.
 */
export const addressSchema = z.object({
  salutation: z.string().max(10).optional(),
  firstName: z.string().min(1, 'required'),
  lastName: z.string().min(1, 'required'),
  street: z.string().min(1, 'required'),
  streetNumber: z.string().min(1, 'required'),
  zipCode: z.string().min(1, 'required'),
  city: z.string().min(1, 'required'),
  countryId: z.string().min(1, 'required'),
  phone: z.string().optional(),
  company: z.string().optional(),
  additionalInfo: z.string().optional(),
});

export type AddressInput = z.infer<typeof addressSchema>;
