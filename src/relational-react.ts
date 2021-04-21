import React, { useDebugValue, useEffect, useMemo, useState } from "react";

export interface Equality<T> {
	(x: T, y: T): boolean;
}

// eslint-disable-next-line
export interface Table<T> {
	reference: symbol;
}

export interface QueryFunction<T> {
	(array: ReadonlyArray<T>): ReadonlyArray<T>;
}

export interface Cleanup {
	(): void;
}

class TableRegistry {
	private registry: any = {};

	public get<T>(table: Table<T>): TableStore<T> {
		return this.registry[table.reference] as TableStore<T>;
	}

	public set<T>(tableReference: symbol, table: TableStore<T>) {
		this.registry[tableReference] = table;
	}

	public delete(tableReference: symbol): void {
		delete this.registry[tableReference];
	}

	public clear(): void {
		this.registry = {};
	}
}

class SubscriberCollection<T> {
	private subscriber: Hook<T>[] = [];

	public subscribe(subscriber: Hook<T>): void {
		this.subscriber.push(subscriber);
	}

	public unsubscribe(subscriber: Hook<T>): void {
		const index = this.subscriber.indexOf(subscriber);
		if (index !== -1) {
			this.subscriber.splice(index, 1);
		}
	}

	public rerender(equalityFn: Equality<T>): void {
		this.subscriber.forEach(s => s.rerender(equalityFn));
	}
}

class TableStore<T> {
	public constructor(equalityFn: Equality<T>) {
		this.equalityFn = equalityFn;
	}

	public readonly reference: symbol = Symbol('relational-react-table-referece');
	private equalityFn: Equality<T>;
	private subscriber = new SubscriberCollection<T>();
	private state: T[] = [];

	public setStateAction: React.Dispatch<React.SetStateAction<T[]>> = state => {
		this.state = typeof state === 'function' ? state(this.state) : state;
		this.rerender();
	}

	public executeQuery(queryFn: QueryFunction<T>): ReadonlyArray<T> {
		return queryFn(this.state);
	}

	private rerender() {
		this.subscriber.rerender(this.equalityFn);
	}

	public subscribe(hook: Hook<T>): void {
		this.subscriber.subscribe(hook);
	}

	public unsubscribe(hook: Hook<T>): void {
		this.subscriber.unsubscribe(hook);
	}
}

class Hook<T> {
	public constructor(table: TableStore<T>, queryFn: QueryFunction<T>, rerender: () => void) {
		this.table = table;
		this.queryFn = queryFn;
		this.triggerRerender = rerender;
	}

	private table: TableStore<T>;
	private queryFn: QueryFunction<T>;
	private triggerRerender: () => void;
	private oldState: ReadonlyArray<T> | undefined = undefined;

	public executeQuery(queryFn: QueryFunction<T>): ReadonlyArray<T> {
		return this.oldState = this.table.executeQuery(this.queryFn = queryFn);
	}

	public rerender(equalityFn: Equality<T>): void {
		const newState = this.table.executeQuery(this.queryFn);
		
		if (this.oldState === undefined || !this.arrayEquals(this.oldState, newState, equalityFn)) {
			this.triggerRerender();
		}

		this.oldState = newState;
	}

	public subscribe(): void {
		this.table.subscribe(this);
	}

	public unsubscribe(): void {
		this.table.unsubscribe(this);
	}

	private arrayEquals(arr1: ReadonlyArray<T>, arr2: ReadonlyArray<T>, equalityFn: Equality<T>): boolean {
		if (arr1.length !== arr2.length) return false;

		for (let i = 0; i < arr1.length; i++) {
			if (!equalityFn(arr1[i], arr2[i])) return false;
		}
	
		return true;
	}
}

interface UseQueryFunction {
	<T>(table: Table<T>, queryFn: QueryFunction<T>, dependencies: ReadonlyArray<any>): ReadonlyArray<T>;
}

const createUseQueryFunction = (registry: TableRegistry): UseQueryFunction => {
	const useQuery = <T>(table: Table<T>, queryFn: (array: ReadonlyArray<T>) => ReadonlyArray<T>, dependencies: ReadonlyArray<any>): ReadonlyArray<T> => {
		const [number, setNumber] = useState<number>(0);
		const [hook] = useState<Hook<T>>(
			() => new Hook(registry.get(table), queryFn, () => setNumber(s => s + 1))
		);

		useEffect(() => {
			hook.subscribe();
			return () => hook.unsubscribe();
		}, [hook]);

		// eslint-disable-next-line
		return useMemo<ReadonlyArray<T>>(() => hook.executeQuery(queryFn), [hook, queryFn, number, ...dependencies]);
	}
	return useQuery;
}

interface CreateTableFunction {
	<T>(keyOrEqualityFn?: keyof T | Equality<T>): [Table<T>, React.Dispatch<React.SetStateAction<Array<T>>>, Cleanup];
}

const createComparator = <T>(keyOrEqualityFn?: keyof T | Equality<T>): Equality<T> => {
	if (keyOrEqualityFn === undefined) {
		return (a, b) => a === b;
	}
	else if (typeof keyOrEqualityFn === 'string') {
		return (a, b) => a[keyOrEqualityFn] === b[keyOrEqualityFn];
	}
	else if (typeof keyOrEqualityFn === 'function') {
		return keyOrEqualityFn;
	}
	else {
		throw new Error('Relational-React: Invalid argument given to createTable() function. Argument must either be undefined, a string which is a key of T or a function that accepts two arguments of type T and returns a boolean.');
	}
}

const createCreateTableFunction = (registry: TableRegistry): CreateTableFunction => {
	return <T>(keyOrEqualityFn?: keyof T | Equality<T>) => {
		const table = new TableStore<T>(createComparator(keyOrEqualityFn));
		registry.set(table.reference, table);

		return [
			{ reference: table.reference },
			table.setStateAction.bind(table),
			() => registry.delete(table.reference)
		]
	}
}

const initiateApi = (): [CreateTableFunction, UseQueryFunction] => {
	const registry = new TableRegistry();

	return [
		createCreateTableFunction(registry),
		createUseQueryFunction(registry)
	]
}

const [_createTable, _useQuery] = initiateApi();

export const createTable = _createTable;

export const useQuery = _useQuery;

/* Additional Utility */

export interface Predicate<T> {
	(value: T): boolean;
}

export interface Comperator<T> {
	(x: T, y: T): number;
}

export interface ManyRelation<T> {
	table: Table<T>;
	where?: Predicate<T>;
}

export interface SingleRelation<T> {
	table: Table<T>;
	where: Predicate<T>;
	order?: Comperator<T>;
	offset?: number;
}

const combinePredicates = <T>(p1?: Predicate<T>, p2?: Predicate<T>): Predicate<T> | undefined => {
	if (p1 === undefined && p2 === undefined) {
		return undefined;
	}
	else if (p1 !== undefined && p2 !== undefined) {
		return value => p1(value) && p2(value);
	}
	else if (p1 !== undefined) {
		return p1;
	}
	else if (p2 !== undefined) { 
		return p2;
	}
	else {
		throw new Error('Relation-React: Bug (1). Combining of two optional predicates failed.');
	}
}

const createDefaultQueryFunction = <T>(where?: Predicate<T>, order?: Comperator<T>, offset?: number, limit?: number): QueryFunction<T> => {
	return state => {
		if (where === undefined) {
			if (order !== undefined) state = [...state].sort((x, y) => order(x, y));
		}
		else {
			const s = state.filter((v) => where(v));
			if (order !== undefined) s.sort((x, y) => order(x, y));
			state = s;
		}

		const off = offset ?? 0;
		const lim = limit ?? state.length;

		return off > 0 || lim < state.length ? state.slice(off, off + lim) : state;
	}
}

export const useMany = <T>(relation: ManyRelation<T>, where?: Predicate<T>, order?: Comperator<T>, offset?: number, limit?: number): ReadonlyArray<T> => {
	const combinedWhere = combinePredicates(relation.where, where);

	const result = useQuery(
		relation.table,
		createDefaultQueryFunction(combinedWhere, order, offset, limit),
		[combinedWhere, order, offset, limit]
	);

	useDebugValue(result);
	return result;
}

export const useSingle = <T>(relation: SingleRelation<T>): T | undefined => {
	const { table, where, order, offset } = relation;

	const result = useQuery(
		table,
		createDefaultQueryFunction(where, order, offset, 1),
		[where, order, offset]
	);
	
	const res = result.length > 0 ? result[0] : undefined;
	useDebugValue(res);
	return res;
}

export const useAll = <T>(table: Table<T>): ReadonlyArray<T> => {
	const result = useQuery(table, array => array, []);
	useDebugValue(result)
	return result;
}