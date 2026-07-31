"use client";

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { propertyFormSchema, type PropertyFormValues } from '@/features/properties/schema';
import { AddressSection } from '@/components/properties/address-section';
import { ContactSection } from '@/components/properties/contact-section';
import { DetailsSection } from '@/components/properties/details-section';
import { ImageUploader } from '@/components/properties/image-uploader';
import { PriceSection } from '@/components/properties/price-section';

export function PropertyForm() {
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<PropertyFormValues>({
    resolver: zodResolver(propertyFormSchema) as never,
    defaultValues: {
      listingType: 'sale',
      propertyType: 'apartment',
      currency: 'USD',
      images: [],
    },
  });

  const onSubmit = async (values: PropertyFormValues) => {
    console.info('Property creation payload', values);
    await new Promise((resolve) => setTimeout(resolve, 500));
    window.alert('Property draft is ready. Backend integration can be added next.');
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Listing overview</h2>
          <p className="text-sm text-slate-600">Create a polished property listing in a few steps.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Listing type</label>
            <select {...register('listingType')} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="sale">Sale</option>
              <option value="rent">Rent</option>
            </select>
            {errors.listingType ? <p className="text-sm text-red-600">{errors.listingType.message}</p> : null}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Property type</label>
            <select {...register('propertyType')} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="apartment">Apartment</option>
              <option value="villa">Villa</option>
              <option value="house">House</option>
              <option value="office">Office</option>
            </select>
            {errors.propertyType ? <p className="text-sm text-red-600">{errors.propertyType.message}</p> : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700">Title</label>
            <input {...register('title')} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            {errors.title ? <p className="text-sm text-red-600">{errors.title.message}</p> : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <label className="text-sm font-medium text-slate-700">Description</label>
            <textarea rows={5} {...register('description')} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
            {errors.description ? <p className="text-sm text-red-600">{errors.description.message}</p> : null}
          </div>
        </div>
      </section>

      <PriceSection register={register} errors={errors} />
      <AddressSection register={register} errors={errors} />
      <DetailsSection register={register} errors={errors} />
      <ContactSection register={register} errors={errors} />

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <ImageUploader value={watch('images') ?? []} onChange={(value) => setValue('images', value, { shouldValidate: true })} />
      </section>

      <div className="flex justify-end">
        <button type="submit" disabled={isSubmitting} className="rounded-lg bg-slate-900 px-5 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70">
          {isSubmitting ? 'Creating listing…' : 'Create property'}
        </button>
      </div>
    </form>
  );
}
