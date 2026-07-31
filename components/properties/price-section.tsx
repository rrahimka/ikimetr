"use client";

import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';

interface PriceSectionProps<TFieldValues extends FieldValues> {
  register: UseFormRegister<TFieldValues>;
  errors: FieldErrors<TFieldValues>;
}

export function PriceSection<TFieldValues extends FieldValues>({ register, errors }: PriceSectionProps<TFieldValues>) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Pricing</h2>
        <p className="text-sm text-slate-600">Set the listing price and currency.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Price</label>
          <input type="number" step="0.01" {...register('price' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.price ? <p className="text-sm text-red-600">{(errors.price as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Currency</label>
          <select {...register('currency' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="TRY">TRY</option>
          </select>
          {errors.currency ? <p className="text-sm text-red-600">{(errors.currency as { message?: string }).message}</p> : null}
        </div>
      </div>
    </section>
  );
}
