import { z } from 'zod';

export const propertyFormSchema = z.object({
  listingType: z.enum(['sale', 'rent']).refine((value) => value, {
    message: 'Please choose a listing type.',
  }),
  propertyType: z.string().min(1, 'Please choose a property type.'),
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  description: z.string().min(20, 'Description must be at least 20 characters.'),
  price: z.coerce.number().positive('Price must be greater than zero.'),
  currency: z.string().min(1, 'Currency is required.'),
  city: z.string().min(1, 'City is required.'),
  district: z.string().min(1, 'District is required.'),
  address: z.string().min(1, 'Address is required.'),
  latitude: z.coerce.number().optional(),
  longitude: z.coerce.number().optional(),
  area: z.coerce.number().positive('Area must be greater than zero.'),
  rooms: z.coerce.number().int().positive('Rooms must be at least 1.'),
  floor: z.coerce.number().int().min(0, 'Floor cannot be negative.'),
  totalFloors: z.coerce.number().int().min(1, 'Total floors must be at least 1.'),
  condition: z.string().min(1, 'Condition is required.'),
  contactPhone: z.string().min(7, 'Contact phone is required.'),
  images: z.array(z.string()).default([]),
});

export type PropertyFormValues = z.infer<typeof propertyFormSchema>;
