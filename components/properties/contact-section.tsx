"use client";

import type { FieldErrors, FieldValues, Path, UseFormRegister } from 'react-hook-form';

interface ContactSectionProps<TFieldValues extends FieldValues> {
  register: UseFormRegister<TFieldValues>;
  errors: FieldErrors<TFieldValues>;
}

export function ContactSection<TFieldValues extends FieldValues>({ register, errors }: ContactSectionProps<TFieldValues>) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Contact information</h2>
        <p className="text-sm text-slate-600">Provide a direct phone number for inquiries.</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Contact phone</label>
        <input {...register('contactPhone' as Path<TFieldValues>)} className="w-full rounded-lg border border-slate-300 px-3 py-2" />
        {errors.contactPhone ? <p className="text-sm text-red-600">{(errors.contactPhone as { message?: string }).message}</p> : null}
      </div>
    </section>
  );
}
