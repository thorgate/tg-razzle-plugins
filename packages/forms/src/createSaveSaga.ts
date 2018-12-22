import { resourceEffectFactory, SagaResource } from '@tg-resources/redux-saga-router';
import { Omit, OptionalMap } from '@thorgate/spa-is';
import { FormikActions } from 'formik';
import { call, delay, race } from 'redux-saga/effects';
import { Attachments, Query, Resource, ResourcePostMethods } from 'tg-resources';
import { createAction } from 'typesafe-actions';

import { FormErrorHandlerOptions, formErrorsHandler } from './formErrors';
import { defaultMessages, ErrorMessages } from './messages';


type PayloadActions<Values> =
    Pick<FormikActions<Values>, 'setErrors' | 'setStatus' | 'setSubmitting'> &
    OptionalMap<Omit<FormikActions<Values>, 'setErrors' | 'setStatus' | 'setSubmitting'>>;


export interface ActionPayload<Values, Params extends { [K in keyof Params]?: string | undefined; } = {}> {
    data: Values;
    kwargs?: Params | null;
    actions: PayloadActions<Values>;

    attachments?: Attachments | null;
    query?: Query | null;
}

export interface ActionType <
    Values,
    Params extends { [K in keyof Params]?: string | undefined; } = {}
> {
    type: string;
    payload: ActionPayload<Values, Params>;
}

export type SaveAction<
    Values,
    Params extends { [K in keyof Params]?: string | undefined; } = {}
> = (payload: ActionPayload<Values, Params>) => ActionType<Values, Params>;


export const createSaveAction = <
    Values,
    Params extends { [K in keyof Params]?: string | undefined; } = {}
>(type: string): SaveAction<Values, Params> => (
    createAction(`@@tg-spa-forms-save/${type}`, (resolve) => (
        (payload: ActionPayload<Values, Params>) => (
            resolve(payload)
        )
    ))
);


export interface CreateFormSaveSagaOptions<
    Values,
    Klass extends Resource,
    Params extends { [K in keyof Params]?: string | undefined; } = {}
> {
    resource?: Klass | SagaResource<Klass>;
    method?: ResourcePostMethods;

    apiSaveHook?: (action: ActionType<Values, Params>) => any | Iterator<any>;
    successHook: (result: any, action: ActionType<Values, Params>) => any | Iterator<any>;
    errorHook?: (options: FormErrorHandlerOptions<Values>) => void | Iterator<any>;

    messages?: ErrorMessages;
    timeoutMs?: number;
}


export const DEFAULT_TIMEOUT = 3000;


export const createFormSaveSaga = <
    Values, Klass extends Resource, Params extends { [K in keyof Params]?: string | undefined; } = {}
>(options: CreateFormSaveSagaOptions<Values, Klass, Params>) => {
    const {
        resource,
        method = 'post',
        apiSaveHook,
        errorHook = formErrorsHandler,
        messages = defaultMessages,
        successHook,
        timeoutMs = DEFAULT_TIMEOUT,
    } = options;

    return function* handleFormSave(action: ActionType<Values, Params>) {
        const { actions } = action.payload;

        try {
            let fetchEffect: any;

            if (resource) {
                fetchEffect = resourceEffectFactory(resource, method, {
                    kwargs: action.payload.kwargs,
                    query: action.payload.query,
                    data: action.payload.data,
                    attachments: action.payload.attachments,
                    requestConfig: { initializeSaga: false }, // Disable initialized saga in this context
                });

            } else if (apiSaveHook) {
                fetchEffect = call(apiSaveHook, action);
            } else {
                throw new Error('Misconfiguration: "resource" or "apiFetchHook" is required formSaveSaga');
            }

            const { response, timeout } = yield race({
                timeout: delay(timeoutMs, true),
                response: fetchEffect,
            });

            if (timeout) {
                throw new Error('Timeout reached, form save failed');
            }

            yield call(successHook, response, action);

        } catch (error) {
            yield call(errorHook, {
                messages,
                error,
                setErrors: actions.setErrors,
                setStatus: actions.setStatus,
            });

        } finally {
            actions.setSubmitting(false);
        }
    };
};
