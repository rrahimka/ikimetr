"use client";

import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';

interface AddressSectionProps<TFieldValues extends FieldValues> {
  register: UseFormRegister<TFieldValues>;
  errors: FieldErrors<TFieldValues>;
}

export function AddressSection<TFieldValues extends FieldValues>({ register, errors }: AddressSectionProps<TFieldValues>) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Address</h2>
          <p className="text-sm text-slate-600">Help buyers or renters find the property easily.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <label className="text-sm font-medium text-slate-700">Address</label>
          <input {...register('address' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.address ? <p className="text-sm text-red-600">{(errors.address as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">City</label>
          <input {...register('city' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.city ? <p className="text-sm text-red-600">{(errors.city as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">District</label>
          <input {...register('district' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.district ? <p className="text-sm text-red-600">{(errors.district as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Latitude</label>
          <input type="number" step="any" {...register('latitude' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Longitude</label>
          <input type="number" step="any" {...register('longitude' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </div>
      </div>
    </section>
  );
}
