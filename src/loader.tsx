import React, { useState, useEffect } from "react";

enum ComponentState {
	Loading,
	Loaded,
	Error
}

export interface ErrorScreenProps {
	errorMessage?: any;
}

const DefaultErrorScreen: React.FC<ErrorScreenProps>
	= props => (<span>{'' + (props.errorMessage ?? 'Error')}</span>);
const DefaultLoadingScreen: React.FC
	= props => null;

interface Props {
	await: () => Promise<any>;
	during?: React.ComponentType;
	catch?: React.ComponentType<ErrorScreenProps>;
	children: React.ReactNode;
}

export const Loader: React.FC<Props> = props => {
	const { children, await: asyncMethod } = props;
	
	const SuccessScreen: React.FC = () => <>{children}</>;
	const LoadingScreen = props.during ?? DefaultLoadingScreen;
	const ErrorScreen = props.catch ?? DefaultErrorScreen;

	const [state, setState] = useState<ComponentState>(ComponentState.Loading);
	const [error, setError] = useState<any>(undefined);

	useEffect(() => {
		asyncMethod()
			.then(
				() => setState(ComponentState.Loaded)
			)
			.catch(reason => {
				setError(reason);
				setState(ComponentState.Error);
			});
	}, [asyncMethod]);

	return [
		<LoadingScreen />,
		<SuccessScreen />,
		<ErrorScreen errorMessage={error} />
	][state];
}

export default Loader;