import type {
  Customer,
  EvaluateRefundPayload,
  EvaluateRefundResponse,
  ApiErrorResponse,
  AdminRefundRequest,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  statusCode?: number;
  details?: Array<{ field?: string; message?: string }>;

  constructor(
    message: string,
    statusCode?: number,
    details?: Array<{ field?: string; message?: string }>
  ) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const data: ApiErrorResponse = await response.json();
    if (data.error) {
      if (data.details && data.details.length > 0) {
        const fieldErrors = data.details
          .map((d) => (d.field ? `${d.field}: ${d.message}` : d.message))
          .filter(Boolean)
          .join('; ');
        return `${data.error}${fieldErrors ? ` (${fieldErrors})` : ''}`;
      }
      return data.error;
    }
    if (data.message) {
      return data.message;
    }
  } catch {
    // Response body was not valid JSON
  }

  switch (response.status) {
    case 400:
      return 'The request was invalid. Please check your form details and try again.';
    case 404:
      return 'The requested resource was not found.';
    case 500:
      return 'An internal server error occurred while processing your request. Please try again later.';
    default:
      return `Request failed with status ${response.status} (${response.statusText || 'Unknown Error'}).`;
  }
}

export async function getCustomers(): Promise<Customer[]> {
  try {
    const response = await fetch(`${API_BASE}/api/customers`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response);
      throw new ApiError(errorMessage, response.status);
    }

    return (await response.json()) as Customer[];
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      error instanceof Error
        ? `Network connection error: ${error.message}`
        : 'Network connection error. Please ensure the backend server is running.';
    throw new ApiError(message);
  }
}

export async function submitRefundEvaluation(
  payload: EvaluateRefundPayload
): Promise<EvaluateRefundResponse> {
  // STRICT REQUIREMENT: Send only orderId, reasonCategory, customerStatement
  const requestBody = {
    orderId: payload.orderId,
    reasonCategory: payload.reasonCategory,
    customerStatement: payload.customerStatement,
  };

  try {
    const response = await fetch(`${API_BASE}/api/refunds/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response);
      throw new ApiError(errorMessage, response.status);
    }

    return (await response.json()) as EvaluateRefundResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      error instanceof Error
        ? `Network connection error: ${error.message}`
        : 'Unable to reach the refund service. Please check your network and try again.';
    throw new ApiError(message);
  }
}

export async function getAdminRequests(): Promise<AdminRefundRequest[]> {
  try {
    const response = await fetch(`${API_BASE}/api/admin/requests`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response);
      throw new ApiError(errorMessage, response.status);
    }

    return (await response.json()) as AdminRefundRequest[];
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      error instanceof Error
        ? `Network connection error: ${error.message}`
        : 'Unable to fetch admin refund requests. Please ensure the backend is running.';
    throw new ApiError(message);
  }
}

export async function getAdminRequestById(id: string): Promise<AdminRefundRequest> {
  try {
    const response = await fetch(`${API_BASE}/api/admin/requests/${id}`, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorMessage = await parseErrorResponse(response);
      throw new ApiError(errorMessage, response.status);
    }

    return (await response.json()) as AdminRefundRequest;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    const message =
      error instanceof Error
        ? `Network connection error: ${error.message}`
        : 'Unable to fetch refund request details.';
    throw new ApiError(message);
  }
}
