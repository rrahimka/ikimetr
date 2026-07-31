"use client";

import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';

interface DetailsSectionProps<TFieldValues extends FieldValues> {
  register: UseFormRegister<TFieldValues>;
  errors: FieldErrors<TFieldValues>;
}

export function DetailsSection<TFieldValues extends FieldValues>({ register, errors }: DetailsSectionProps<TFieldValues>) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Property details</h2>
        <p className="text-sm text-slate-600">Provide the main listing characteristics.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Area (m²)</label>
          <input type="number" {...register('area' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.area ? <p className="text-sm text-red-600">{(errors.area as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Rooms</label>
          <input type="number" {...register('rooms' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.rooms ? <p className="text-sm text-red-600">{(errors.rooms as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Floor</label>
          <input type="number" {...register('floor' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.floor ? <p className="text-sm text-red-600">{(errors.floor as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Total floors</label>
          <input type="number" {...register('totalFloors' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
          {errors.totalFloors ? <p className="text-sm text-red-600">{(errors.totalFloors as { message?: string }).message}</p> : null}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-700">Property condition</label>
          <select {...register('condition' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2">
            <option value="">Select condition</option>
            <option value="new">New</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
          </select>
          {errors.condition ? <p className="text-sm text-red-600">{(errors.condition as { message?: string }).message}</p> : null}
        </div>
      </div>
    </section>
  );
}
