import { PropertyForm } from '@/components/properties/property-form';

export default function NewPropertyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-16">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Property creation</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Create a new listing</h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600">
            Publish a polished property listing with rich details, address data, contact information, and image uploads.
          </p>
        </div>

        <PropertyForm />
      </div>
    </main>
  );
}
